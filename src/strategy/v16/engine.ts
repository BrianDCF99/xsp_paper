import { AppConfig } from "../../config/schema.js";
import { ExitReason, OpenPositionRow, StrategyMessageEvent } from "../../domain/types.js";
import { BybitClient } from "../../infra/bybit/client.js";
import { PaperStore } from "../../infra/db/paperStore.js";
import { TelegramClient } from "../../infra/telegram/client.js";
import { Logger } from "../../utils/logger.js";
import { HOUR_MS } from "../../utils/time.js";
import {
  applyCosts,
  leveragedReturnPct,
  liquidationThresholdUnleveredPct,
  pnlUsdFromUnleveredPct,
  qtyFromNotional,
  shortUnleveredReturnPct
} from "./math.js";
import { formatEntryMessage, formatExitMessage } from "./messages.js";
import { V16SignalDetector } from "./signalDetector.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class XspV16PaperEngine {
  private inCycle = false;
  private readonly detector: V16SignalDetector;

  constructor(
    private readonly cfg: AppConfig,
    private readonly bybit: BybitClient,
    private readonly store: PaperStore,
    private readonly telegram: TelegramClient,
    private readonly logger: Logger
  ) {
    this.detector = new V16SignalDetector(bybit, cfg.strategy);
  }

  async bootstrap(): Promise<void> {
    await this.store.bootstrapRuntime(this.cfg.strategy.id);
    await this.refreshSymbolsIfNeeded(true);
  }

  async runCycle(trigger: "timer" | "manual" = "timer"): Promise<{ executed: boolean; reason?: string }> {
    if (this.inCycle) return { executed: false, reason: "cycle_in_progress" };
    this.inCycle = true;
    const startedAt = Date.now();
    const cycleNowTs = Date.now();
    try {
      const lastScanKey = `${this.cfg.strategy.id}:last_scan_ts`;
      const lastScanRaw = await this.store.getRuntimeValue(lastScanKey);
      const lastScanTs = Number(lastScanRaw ?? "0") || 0;

      await this.refreshSymbolsIfNeeded(false);
      await this.evaluateOpenPositionsForExit(lastScanTs, cycleNowTs);
      await this.scanAndHandleSignals();
      await this.store.setRuntimeValue(lastScanKey, String(cycleNowTs));
      this.logger.info("cycle complete", { trigger, durationMs: Date.now() - startedAt });
      return { executed: true };
    } catch (error) {
      this.logger.error("cycle failed", { trigger, error: error instanceof Error ? error.message : String(error) });
      return { executed: false, reason: "cycle_failed" };
    } finally {
      this.inCycle = false;
    }
  }

  private async refreshSymbolsIfNeeded(force: boolean): Promise<void> {
    const key = `${this.cfg.strategy.id}:last_symbol_refresh_ts`;
    const lastRaw = await this.store.getRuntimeValue(key);
    const last = Number(lastRaw ?? "0") || 0;
    const due = force || Date.now() - last >= this.cfg.app.symbolRefreshIntervalMs;
    if (!due) return;

    const instruments = await this.bybit.getLinearPerpSymbols(1000);
    const active = instruments
      .filter((i) => i.status.toLowerCase() === "trading" || i.status.toLowerCase() === "settling")
      .map((i) => i.symbol)
      .slice(0, this.cfg.bybit.maxSymbols);

    await this.store.upsertSymbols(active);
    await this.store.setRuntimeValue(key, String(Date.now()));
    this.logger.info("symbol universe refreshed", { count: active.length });
  }

  private async scanAndHandleSignals(): Promise<void> {
    const symbols = await this.store.getActiveSymbols(this.cfg.bybit.maxSymbols);
    if (symbols.length === 0) {
      this.logger.warn("no active symbols in db");
      return;
    }

    const batchSize = this.cfg.bybit.symbolBatchSize;

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);

      const results = await Promise.all(
        batch.map(async (symbol) => {
          try {
            const decision = await this.detector.detect(symbol);
            return { symbol, decision, error: null as string | null };
          } catch (error) {
            return { symbol, decision: null, error: error instanceof Error ? error.message : String(error) };
          }
        })
      );

      for (const r of results) {
        if (r.error) {
          this.logger.warn("signal detect failed", { symbol: r.symbol, error: r.error });
          continue;
        }
        if (!r.decision) continue;
        await this.handleSignal(r.decision);
      }

      if (this.cfg.bybit.requestPauseMs > 0) {
        await sleep(this.cfg.bybit.requestPauseMs);
      }
    }
  }

  private async handleSignal(decision: NonNullable<Awaited<ReturnType<V16SignalDetector["detect"]>>>): Promise<void> {
    const existing = await this.store.findSignal(decision.symbol, decision.closedHourStartMs);
    if (existing) return;

    const signalId = await this.store.createSignal(decision);

    const openOnSame = this.cfg.strategy.preventDuplicateSymbols
      ? await this.store.getOpenPositionBySymbol(decision.symbol)
      : null;

    if (openOnSame) {
      await this.store.setSignalOutcome(signalId, "MISSED_DUPLICATE", "symbol_already_open");
      return;
    }

    const summaryBefore = await this.store.getSummary(this.cfg.strategy.startingEquityUsd);
    const cash = summaryBefore.cashUsd;
    const entryEquity = summaryBefore.currentEquityUsd;

    const marginUsd = Math.min(entryEquity * this.cfg.strategy.entryMarginFraction, this.cfg.strategy.entryMarginCapUsd, cash);

    if (!Number.isFinite(decision.nextOpenPrice) || decision.nextOpenPrice <= 0) {
      await this.store.setSignalOutcome(signalId, "MISSED_INVALID_PRICE", "invalid_next_open_price");
      return;
    }

    if (!Number.isFinite(marginUsd) || marginUsd < this.cfg.strategy.minActiveCashUsd) {
      await this.store.setSignalOutcome(signalId, "MISSED_NO_CASH", "insufficient_cash");
      return;
    }

    const openPositions = await this.store.getOpenPositions();
    const atCap = openPositions.length >= this.cfg.strategy.maxOpenPositions;

    let replaced: OpenPositionRow | null = null;
    if (atCap) {
      replaced = this.selectWorstReplaceCandidate(openPositions);
      const thresholdPct = this.cfg.strategy.replaceThresholdPct * 100;
      const candidateMetric = this.cfg.strategy.replaceThresholdBasis === "levered"
        ? (replaced?.latestLeveragedReturnPct ?? 0)
        : (replaced?.latestUnleveredReturnPct ?? 0);

      if (!replaced || candidateMetric > -thresholdPct) {
        await this.store.setSignalOutcome(signalId, "MISSED_CAPACITY", "capacity_no_replace_candidate");
        return;
      }

      const exitMark = replaced.latestMarkPrice ?? replaced.entryPrice;
      await this.closePositionWithAlert(replaced, "REPLACE", Date.now(), exitMark);
    }

    const notionalUsd = marginUsd * this.cfg.strategy.leverage;
    const qty = qtyFromNotional(notionalUsd, decision.nextOpenPrice);

    const row = await this.store.openPosition({
      symbol: decision.symbol,
      signalId,
      entryTsMs: decision.closedHourEndMs,
      signalHourStartMs: decision.closedHourStartMs,
      entryPrice: decision.nextOpenPrice,
      entrySellRatio: decision.signalSellRatio,
      closedHourVolume: decision.closedHourVolume,
      leverage: this.cfg.strategy.leverage,
      marginUsd,
      notionalUsd,
      qty,
      takeProfitPct: this.cfg.strategy.takeProfitPct,
      deltaExitThreshold: this.cfg.strategy.deltaExitThreshold,
      replaceThresholdPct: this.cfg.strategy.replaceThresholdPct
    });

    await this.store.setSignalOutcome(
      signalId,
      replaced ? "OPENED_REPLACEMENT" : "OPENED",
      replaced ? `replaced:${replaced.symbol}` : "opened"
    );

    await this.sendEntryAlert(
      {
        type: replaced ? "ENTRY_REPLACE_OPEN_SHORT" : "ENTRY_OPEN_SHORT",
        symbol: decision.symbol,
        sellRatio: decision.signalSellRatio,
        sellRatioThreshold: this.cfg.strategy.sellRatioMax,
        hourVolume: decision.closedHourVolume,
        volumeThreshold: this.cfg.strategy.minHourVolume,
        entryPrice: decision.nextOpenPrice,
        takeProfitPrice: decision.nextOpenPrice * (1 - this.cfg.strategy.takeProfitPct),
        replacedSymbol: replaced?.symbol,
        replacedPnlPct: replaced?.latestLeveragedReturnPct ?? undefined,
        replacedUnleveredPct: replaced?.latestUnleveredReturnPct ?? undefined,
        leverage: this.cfg.strategy.leverage
      },
      row.id
    );
  }

  private selectWorstReplaceCandidate(openPositions: OpenPositionRow[]): OpenPositionRow | null {
    if (openPositions.length === 0) return null;
    const sorted = [...openPositions].sort((a, b) => {
      const av = this.cfg.strategy.replaceThresholdBasis === "levered"
        ? (a.latestLeveragedReturnPct ?? 0)
        : (a.latestUnleveredReturnPct ?? 0);
      const bv = this.cfg.strategy.replaceThresholdBasis === "levered"
        ? (b.latestLeveragedReturnPct ?? 0)
        : (b.latestUnleveredReturnPct ?? 0);
      return av - bv;
    });
    return sorted[0] ?? null;
  }

  private async evaluateOpenPositionsForExit(lastScanTs: number, nowTs: number): Promise<void> {
    const open = await this.store.getOpenPositions();
    if (open.length === 0) return;

    for (const pos of open) {
      const reconciledExit =
        this.cfg.strategy.reconcileDowntimeExits && lastScanTs > 0
          ? await this.evaluateDowntimeExit(pos, lastScanTs, nowTs)
          : null;

      if (reconciledExit) {
        await this.closePositionWithAlert(pos, reconciledExit.reason, reconciledExit.exitTsMs, reconciledExit.exitPrice);
        this.logger.info("downtime exit reconciled", {
          symbol: pos.symbol,
          reason: reconciledExit.reason,
          exitTsMs: reconciledExit.exitTsMs
        });
        continue;
      }

      const ticker = await this.bybit.getTicker(pos.symbol);
      if (!ticker || ticker.markPrice <= 0) continue;

      const mark = ticker.markPrice;
      const unlev = shortUnleveredReturnPct(pos.entryPrice, mark);
      const lev = leveragedReturnPct(unlev, pos.leverage);
      const grossPnl = pnlUsdFromUnleveredPct(pos.marginUsd, pos.leverage, unlev);

      await this.store.updatePositionMark(pos.id, mark, nowTs, unlev, lev, grossPnl);

      const exit = await this.decideExit(pos, unlev, nowTs);
      if (!exit) continue;

      await this.closePositionWithAlert(pos, exit, nowTs, mark);
    }
  }

  private async computeFundingUsd(symbol: string, notionalUsd: number, entryTsMs: number, exitTsMs: number): Promise<number> {
    if (!this.cfg.funding.enabled) return 0;
    if (!Number.isFinite(notionalUsd) || notionalUsd <= 0 || exitTsMs <= entryTsMs) return 0;
    const points = await this.bybit.getFundingHistory(symbol, entryTsMs, exitTsMs);
    if (points.length === 0) return 0;
    const totalRate = points.reduce((sum, p) => sum + p.fundingRate, 0);
    const signedRate = this.cfg.funding.shortReceivesWhenPositive ? totalRate : -totalRate;
    return notionalUsd * signedRate;
  }

  private async decideExit(pos: OpenPositionRow, unleveredPct: number, nowTs: number): Promise<ExitReason | null> {
    const liqUnlev = liquidationThresholdUnleveredPct(pos.leverage);
    if (unleveredPct <= liqUnlev) return "LIQ";

    const tpPct = pos.takeProfitPct * 100;
    if (unleveredPct >= tpPct) return "TP";

    // Delta exit: current hourly sell-ratio - entry sell-ratio >= threshold.
    const ratios = await this.bybit.getAccountRatio1h(pos.symbol, 2);
    const latest = ratios.at(-1)?.sellRatio ?? null;
    if (latest !== null) {
      const delta = latest - pos.entrySellRatio;
      if (delta >= pos.deltaExitThreshold) return "DELTA";
    }

    if (this.cfg.strategy.maxHoldHours > 0) {
      const heldMs = nowTs - pos.entryTsMs;
      if (heldMs >= this.cfg.strategy.maxHoldHours * HOUR_MS) return "TIME";
    }

    return null;
  }

  private async closePositionWithAlert(pos: OpenPositionRow, exitReason: ExitReason, exitTsMs: number, exitPrice: number): Promise<void> {
    const unlev = shortUnleveredReturnPct(pos.entryPrice, exitPrice);
    const lev = leveragedReturnPct(unlev, pos.leverage);
    const grossPnl = pnlUsdFromUnleveredPct(pos.marginUsd, pos.leverage, unlev);
    const costs = applyCosts(pos.notionalUsd, this.cfg.costs, pos.entryPrice, exitPrice);
    const fundingUsd = await this.computeFundingUsd(pos.symbol, pos.notionalUsd, pos.entryTsMs, exitTsMs);
    const pnl = grossPnl - costs.totalCostUsd + fundingUsd;

    await this.store.closePosition({
      positionId: pos.id,
      symbol: pos.symbol,
      exitTsMs,
      exitPrice,
      exitReason,
      unleveredReturnPct: unlev,
      leveragedReturnPct: lev,
      pnlUsd: pnl,
      feesUsd: costs.totalFeesUsd,
      slippageUsd: costs.totalSlippageUsd,
      netFundingFeeUsd: fundingUsd
    });

    await this.sendExitAlert(
      {
        type: "EXIT",
        symbol: pos.symbol,
        exitReason,
        leverage: pos.leverage,
        leveragedReturnPct: lev,
        unleveredReturnPct: unlev,
        netFundingFeeUsd: fundingUsd
      },
      pos.id
    );
  }

  private async evaluateDowntimeExit(
    pos: OpenPositionRow,
    lastScanTs: number,
    nowTs: number
  ): Promise<{ reason: ExitReason; exitTsMs: number; exitPrice: number } | null> {
    const maxLookbackMs = this.cfg.strategy.downtimeLookbackHoursMax * HOUR_MS;
    const windowStart = Math.max(pos.entryTsMs, lastScanTs, nowTs - maxLookbackMs);
    if (nowTs <= windowStart) return null;

    const hours = Math.ceil((nowTs - windowStart) / HOUR_MS) + 3;
    const klineLimit = Math.max(3, Math.min(200, hours));
    const klines = await this.bybit.getKlines1h(pos.symbol, klineLimit);
    if (klines.length === 0) return null;

    const candidates: Array<{ reason: ExitReason; exitTsMs: number; exitPrice: number; priority: number }> = [];

    const liqPrice = pos.entryPrice * (1 + 1 / pos.leverage);
    const tpPrice = pos.entryPrice * (1 - pos.takeProfitPct);

    for (const candle of klines) {
      const candleStart = candle.openTimeMs;
      const candleEnd = candleStart + HOUR_MS;
      if (candleEnd <= windowStart || candleStart > nowTs) continue;

      const hitLiq = candle.high >= liqPrice;
      const hitTp = candle.low <= tpPrice;
      if (!hitLiq && !hitTp) continue;

      if (hitLiq) {
        candidates.push({
          reason: "LIQ",
          exitTsMs: Math.min(candleEnd, nowTs),
          exitPrice: liqPrice,
          priority: 1
        });
      } else {
        candidates.push({
          reason: "TP",
          exitTsMs: Math.min(candleEnd, nowTs),
          exitPrice: tpPrice,
          priority: 2
        });
      }
      break;
    }

    if (this.cfg.strategy.maxHoldHours > 0) {
      const timeTs = pos.entryTsMs + this.cfg.strategy.maxHoldHours * HOUR_MS;
      if (timeTs >= windowStart && timeTs <= nowTs) {
        const timePrice = this.priceAtTsFromKlines(klines, timeTs) ?? klines.at(-1)?.close ?? pos.entryPrice;
        candidates.push({
          reason: "TIME",
          exitTsMs: timeTs,
          exitPrice: timePrice,
          priority: 4
        });
      }
    }

    const ratioLookback = Math.max(2, Math.min(200, hours + 4));
    const ratios = await this.bybit.getAccountRatio1h(pos.symbol, ratioLookback);
    for (const r of ratios) {
      if (r.tsMs < windowStart || r.tsMs > nowTs) continue;
      if (r.sellRatio === null) continue;
      const delta = r.sellRatio - pos.entrySellRatio;
      if (delta >= pos.deltaExitThreshold) {
        const price = this.priceAtTsFromKlines(klines, r.tsMs) ?? klines.at(-1)?.close ?? pos.entryPrice;
        candidates.push({
          reason: "DELTA",
          exitTsMs: r.tsMs,
          exitPrice: price,
          priority: 3
        });
        break;
      }
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => (a.exitTsMs - b.exitTsMs) || (a.priority - b.priority));
    const selected = candidates[0];
    return selected ? { reason: selected.reason, exitTsMs: selected.exitTsMs, exitPrice: selected.exitPrice } : null;
  }

  private priceAtTsFromKlines(klines: Array<{ openTimeMs: number; close: number }>, tsMs: number): number | null {
    for (const candle of klines) {
      const start = candle.openTimeMs;
      const end = start + HOUR_MS;
      if (tsMs >= start && tsMs < end) {
        return Number.isFinite(candle.close) && candle.close > 0 ? candle.close : null;
      }
    }

    const prior = [...klines].filter((k) => k.openTimeMs <= tsMs).at(-1);
    if (!prior) return null;
    return Number.isFinite(prior.close) && prior.close > 0 ? prior.close : null;
  }

  private async sendEntryAlert(event: StrategyMessageEvent, positionId: string): Promise<void> {
    const summary = await this.store.getSummary(this.cfg.strategy.startingEquityUsd);
    const text = formatEntryMessage(this.cfg.strategy.title, event, summary);
    const messageId = await this.telegram.sendMessage(text);
    await this.store.insertAlert(event.type, event.symbol, text, positionId, messageId);
  }

  private async sendExitAlert(event: StrategyMessageEvent, positionId: string): Promise<void> {
    const summary = await this.store.getSummary(this.cfg.strategy.startingEquityUsd);
    const text = formatExitMessage(this.cfg.strategy.title, event, summary);
    const messageId = await this.telegram.sendMessage(text);
    await this.store.insertAlert(`EXIT_${event.exitReason ?? "UNKNOWN"}`, event.symbol, text, positionId, messageId);
  }
}
