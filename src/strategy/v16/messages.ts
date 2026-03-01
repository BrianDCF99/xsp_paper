import { LiveSummary, OpenPositionRow, StrategyMessageEvent } from "../../domain/types.js";
import { escapeHtml, fmtNum, fmtPct, fmtUsd, tickerLink } from "../../utils/format.js";
import { formatElapsedHhMm } from "../../utils/time.js";

const XSP_EMOJI = "🐦‍🔥";

function exchangeLabelFromTitle(title: string): "BYBIT" | "MEXC" {
  const t = String(title ?? "").toLowerCase();
  if (t.includes("mexc")) return "MEXC";
  return "BYBIT";
}

function cleanStrategyTitle(title: string): string {
  let out = String(title ?? "").trim();
  out = out.replace(/\(paper\)/gi, "").trim();
  out = out.replace(/^bybit[\s:-]*/i, "").trim();
  out = out.replace(/^mexc[\s:-]*/i, "").trim();
  return out.length > 0 ? out : String(title ?? "").trim();
}

function strategyHeader(title: string): string {
  return `${XSP_EMOJI} <b>${exchangeLabelFromTitle(title)}:</b> ${escapeHtml(cleanStrategyTitle(title))}`;
}

function calcShortTpPrice(entryPrice: number, takeProfitPct: number): number {
  return entryPrice * (1 - takeProfitPct);
}

function calcShortLiqPrice(entryPrice: number, leverage: number): number {
  if (!Number.isFinite(leverage) || leverage <= 0) return entryPrice;
  return entryPrice * (1 + 1 / leverage);
}

function unrealizedPct(summary: LiveSummary): number {
  if (!Number.isFinite(summary.currentEquityUsd) || summary.currentEquityUsd === 0) return 0;
  return (summary.unrealizedPnlUsd / summary.currentEquityUsd) * 100;
}

function formatAccountUpdate(summary: LiveSummary): string[] {
  return [
    "<b>Account Update:</b>",
    `Eq: ${fmtUsd(summary.currentEquityUsd)} | Cash: ${fmtUsd(summary.cashUsd)}`,
    `M: ${fmtUsd(summary.marginInUseUsd)} | N: ${fmtUsd(summary.openNotionalUsd)}`
  ];
}

export function formatSummaryBlock(summary: LiveSummary): string[] {
  return [
    "<b>Live Stats:</b>",
    `PNL: ${fmtPct(summary.pnlPct)} | ${fmtUsd(summary.totalPnlUsd)}`,
    `Unrealized PNL: ${fmtUsd(summary.unrealizedPnlUsd)} | ${fmtPct(unrealizedPct(summary))}`,
    `Entries: ${summary.entries} | O: ${summary.openPositions} | M: ${summary.missedTrades}`,
    `Winners: ${summary.winners} | Losers: ${summary.losers} | Win %: ${summary.winPct.toFixed(2)}%`,
    `Replaced: ${summary.replaced} | Liq'd: ${summary.liquidated}`,
    `Eq: ${fmtUsd(summary.currentEquityUsd)} | Cash: ${fmtUsd(summary.cashUsd)}`,
    `M: ${fmtUsd(summary.marginInUseUsd)} | N: ${fmtUsd(summary.openNotionalUsd)}`,
    `Net Funding: ${fmtUsd(summary.openFundingAccruedUsd)}`
  ];
}

export function formatEntryMessage(title: string, event: StrategyMessageEvent, summary: LiveSummary): string {
  const entryPrice = event.entryPrice ?? 0;
  const tpPrice = event.takeProfitPrice ?? calcShortTpPrice(entryPrice, 0);
  const liqPrice = calcShortLiqPrice(entryPrice, event.leverage ?? 0);

  const lines = [
    strategyHeader(title),
    "",
    event.type === "ENTRY_REPLACE_OPEN_SHORT" ? "♻️ <b>Entry Replace Short</b>" : "🟢 <b>Entry</b>",
    `- Sell Ratio ≤ ${fmtNum(event.sellRatioThreshold ?? 0, 3)} (now ${fmtNum(event.sellRatio ?? 0, 3)})`,
    `- 1h Volume ≥ ${fmtNum(event.volumeThreshold ?? 0, 0)} (now ${fmtNum(event.hourVolume ?? 0, 0)})`,
    tickerLink(event.symbol),
    `E: ${fmtUsd(entryPrice)} | TP: ${fmtUsd(tpPrice)} | L: ${fmtUsd(liqPrice)}`,
    `Entry Slippage: ${fmtNum(event.entrySlippageBps ?? 0, 2)} bps`
  ];

  if (event.type === "ENTRY_REPLACE_OPEN_SHORT" && event.replacedSymbol) {
    lines.push(`Old Ticker: ${tickerLink(event.replacedSymbol)}`);
    lines.push(`Old Trade PnL: ${fmtPct(event.replacedPnlPct ?? 0)}`);
    lines.push(`Old Trade Unlev: ${fmtPct(event.replacedUnleveredPct ?? 0)}`);
  }

  lines.push("", ...formatAccountUpdate(summary), "", ...formatSummaryBlock(summary));
  return lines.join("\n");
}

export function formatExitMessage(title: string, event: StrategyMessageEvent, summary: LiveSummary): string {
  const reason =
    event.exitReason === "TP"
      ? "TP"
      : event.exitReason === "DELTA"
        ? "DELTA"
        : event.exitReason === "TIME"
          ? "TIME"
          : event.exitReason === "LIQ"
            ? "LIQUIDATED"
            : "REPLACE";
  const icon = (event.leveragedReturnPct ?? 0) >= 0 ? "✅" : "❌";

  return [
    strategyHeader(title),
    "",
    `${icon} <b>EXIT: ${reason}</b>`,
    tickerLink(event.symbol),
    `PnL: ${fmtPct(event.leveragedReturnPct ?? 0)}`,
    `Exit Slippage: ${fmtNum(event.exitSlippageBps ?? 0, 2)} bps`,
    `Roundtrip Slippage: ${fmtNum((event.entrySlippageBps ?? 0) + (event.exitSlippageBps ?? 0), 2)} bps`,
    `Funding: ${fmtUsd(event.netFundingFeeUsd ?? 0)}`,
    "",
    ...formatAccountUpdate(summary),
    "",
    ...formatSummaryBlock(summary)
  ].join("\n");
}

export function formatXspCommand(title: string, summary: LiveSummary, rows: OpenPositionRow[], nowTsMs: number): string {
  const lines: string[] = [
    strategyHeader(title),
    "",
    "📈 Open Positions",
    "",
    `<b>OPEN SHORT</b> - Open Positions: ${rows.length}`
  ];

  if (rows.length === 0) {
    lines.push("(none)");
  } else {
    rows.forEach((r, i) => {
      const currentPrice = r.latestMarkPrice ?? r.entryPrice;
      const tpPrice = calcShortTpPrice(r.entryPrice, r.takeProfitPct);
      const liqPrice = calcShortLiqPrice(r.entryPrice, r.leverage);
      lines.push(
        `${i + 1}. ${tickerLink(r.symbol)}`,
        `E: ${fmtUsd(r.entryPrice)} | PNL: ${fmtPct(r.latestLeveragedReturnPct ?? 0)} | DD - ${formatElapsedHhMm(r.entryTsMs, nowTsMs)}`,
        `C: ${fmtUsd(currentPrice)} | TP: ${fmtUsd(tpPrice)} | L: ${fmtUsd(liqPrice)}`,
        ""
      );
    });
  }

  lines.push("", ...formatSummaryBlock(summary));
  return lines.join("\n");
}

export function formatXspOpenOnly(title: string, rows: OpenPositionRow[], nowTsMs: number): string {
  const lines: string[] = [
    strategyHeader(title),
    "",
    "📈 Open Positions",
    "",
    `<b>OPEN SHORT</b> - Open Positions: ${rows.length}`
  ];

  if (rows.length === 0) {
    lines.push("(none)");
    return lines.join("\n");
  }

  rows.forEach((r, i) => {
    const currentPrice = r.latestMarkPrice ?? r.entryPrice;
    const tpPrice = calcShortTpPrice(r.entryPrice, r.takeProfitPct);
    const liqPrice = calcShortLiqPrice(r.entryPrice, r.leverage);
    lines.push(
      `${i + 1}. ${tickerLink(r.symbol)}`,
      `E: ${fmtUsd(r.entryPrice)} | PNL: ${fmtPct(r.latestLeveragedReturnPct ?? 0)} | DD - ${formatElapsedHhMm(r.entryTsMs, nowTsMs)}`,
      `C: ${fmtUsd(currentPrice)} | TP: ${fmtUsd(tpPrice)} | L: ${fmtUsd(liqPrice)}`,
      ""
    );
  });

  return lines.join("\n");
}

export function formatFundingEventMessage(
  title: string,
  symbol: string,
  fundingDeltaUsd: number,
  pointsCount: number,
  summary: LiveSummary
): string {
  const flow = fundingDeltaUsd >= 0 ? "coming in" : "leaving";
  return [
    strategyHeader(title),
    "",
    "💸 <b>Funding Update:</b>",
    `1. ${tickerLink(symbol)}: ${fmtUsd(fundingDeltaUsd)} | Net: ${fmtUsd(fundingDeltaUsd)} (${flow})`,
    `Settlements in update: ${fmtNum(pointsCount, 0)}`,
    "",
    ...formatAccountUpdate(summary)
  ].join("\n");
}

export function formatInfoCommand(
  title: string,
  strategy: {
    leverage: number;
    entryMarginFraction: number;
    entryMarginCapUsd: number;
    sellRatioMax: number;
    minHourVolume: number;
    takeProfitPct: number;
    deltaExitThreshold: number;
    maxHoldHours: number;
    replaceThresholdPct: number;
    replaceThresholdBasis: "unlevered" | "levered";
  }
): string {
  const marginPct = strategy.entryMarginFraction * 100;
  const tpPct = strategy.takeProfitPct * 100;
  const replacePct = strategy.replaceThresholdPct * 100;
  const exitLines = [
    `- TP: ${tpPct.toFixed(2)}%`,
    `- Delta: Sell Ratio +${fmtNum(strategy.deltaExitThreshold, 3)}`,
    "- Liquidation",
    strategy.maxHoldHours > 0 ? `- Time: ${fmtNum(strategy.maxHoldHours, 0)}h` : "- Time: off",
    `- Replacement: -${replacePct.toFixed(2)}% (${strategy.replaceThresholdBasis})`
  ];

  return [
    strategyHeader(title),
    "",
    `Leverage: ${fmtNum(strategy.leverage, 2)}x`,
    `Margin: min(${fmtUsd(strategy.entryMarginCapUsd)}, cash * ${marginPct.toFixed(2)}%)`,
    "",
    "Entry:",
    `- Sell Ratio ≤ ${fmtNum(strategy.sellRatioMax, 3)}`,
    `- 1h Volume ≥ ${fmtNum(strategy.minHourVolume, 0)}`,
    "",
    "Exit:",
    ...exitLines
  ].join("\n");
}
