import { SupabaseClient } from "@supabase/supabase-js";
import {
  ExitReason,
  LiveSummary,
  OpenPositionRow,
  SignalOutcome,
  V16SignalDecision
} from "../../domain/types.js";

export interface CreatePositionInput {
  symbol: string;
  signalId: string;
  entryTsMs: number;
  signalHourStartMs: number;
  entryPrice: number;
  entrySellRatio: number;
  closedHourVolume: number;
  leverage: number;
  marginUsd: number;
  notionalUsd: number;
  qty: number;
  takeProfitPct: number;
  deltaExitThreshold: number;
  replaceThresholdPct: number;
}

export interface ClosePositionInput {
  positionId: string;
  symbol: string;
  exitTsMs: number;
  exitPrice: number;
  exitReason: ExitReason;
  unleveredReturnPct: number;
  leveragedReturnPct: number;
  pnlUsd: number;
  feesUsd: number;
  slippageUsd: number;
  netFundingFeeUsd: number;
}

export class PaperStore {
  constructor(private readonly db: SupabaseClient) {}

  async bootstrapRuntime(strategyId: string): Promise<void> {
    const defaults = [
      { key: `${strategyId}:last_scan_ts`, value_text: "0" },
      { key: `${strategyId}:last_symbol_refresh_ts`, value_text: "0" },
      { key: `${strategyId}:telegram_offset`, value_text: "0" }
    ];

    const { error } = await this.db.from("xsp_runtime_state").upsert(defaults, { onConflict: "key" });
    if (error) throw error;
  }

  async getRuntimeValue(key: string): Promise<string | null> {
    const { data, error } = await this.db.from("xsp_runtime_state").select("value_text").eq("key", key).maybeSingle();
    if (error) throw error;
    return data?.value_text ?? null;
  }

  async setRuntimeValue(key: string, value: string): Promise<void> {
    const { error } = await this.db
      .from("xsp_runtime_state")
      .upsert({ key, value_text: value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) throw error;
  }

  async upsertSymbols(symbols: string[]): Promise<void> {
    if (symbols.length === 0) return;
    const rows = symbols.map((symbol) => ({ symbol, is_active: true, updated_at: new Date().toISOString() }));
    const { error } = await this.db.from("xsp_symbols").upsert(rows, { onConflict: "symbol" });
    if (error) throw error;
  }

  async getActiveSymbols(limit: number): Promise<string[]> {
    const { data, error } = await this.db.from("xsp_symbols").select("symbol").eq("is_active", true).order("symbol").limit(limit);
    if (error) throw error;
    return (data ?? []).map((r) => String(r.symbol));
  }

  async findSignal(symbol: string, hourStartMs: number): Promise<{ id: string; outcome: SignalOutcome } | null> {
    const { data, error } = await this.db
      .from("xsp_signals")
      .select("id,outcome")
      .eq("symbol", symbol)
      .eq("hour_start_ms", hourStartMs)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { id: String(data.id), outcome: data.outcome as SignalOutcome };
  }

  async createSignal(decision: V16SignalDecision): Promise<string> {
    const { data, error } = await this.db
      .from("xsp_signals")
      .insert({
        symbol: decision.symbol,
        hour_start_ms: decision.closedHourStartMs,
        hour_end_ms: decision.closedHourEndMs,
        sell_ratio: decision.signalSellRatio,
        hour_volume: decision.closedHourVolume,
        close_price: decision.closePrice,
        next_open_price: decision.nextOpenPrice,
        outcome: "PENDING"
      })
      .select("id")
      .single();
    if (error) throw error;
    return String(data.id);
  }

  async setSignalOutcome(signalId: string, outcome: SignalOutcome, reason: string): Promise<void> {
    const { error } = await this.db
      .from("xsp_signals")
      .update({ outcome, outcome_reason: reason, processed_at: new Date().toISOString() })
      .eq("id", signalId);
    if (error) throw error;
  }

  async openPosition(input: CreatePositionInput): Promise<OpenPositionRow> {
    const { data, error } = await this.db
      .from("xsp_positions")
      .insert({
        symbol: input.symbol,
        signal_id: input.signalId,
        status: "OPEN",
        entry_ts_ms: input.entryTsMs,
        signal_hour_start_ms: input.signalHourStartMs,
        entry_price: input.entryPrice,
        entry_sell_ratio: input.entrySellRatio,
        signal_hour_volume: input.closedHourVolume,
        leverage: input.leverage,
        margin_usd: input.marginUsd,
        notional_usd: input.notionalUsd,
        qty: input.qty,
        take_profit_pct: input.takeProfitPct,
        delta_exit_threshold: input.deltaExitThreshold,
        replace_threshold_pct: input.replaceThresholdPct,
        latest_mark_price: input.entryPrice,
        latest_unlevered_return_pct: 0,
        latest_leveraged_return_pct: 0,
        latest_unrealized_pnl_usd: 0,
        latest_funding_accrued_usd: 0,
        latest_mark_ts_ms: input.entryTsMs
      })
      .select(
        "id,symbol,entry_price,entry_ts_ms,signal_hour_volume,leverage,margin_usd,notional_usd,entry_sell_ratio,take_profit_pct,delta_exit_threshold,latest_mark_price,latest_leveraged_return_pct,latest_unlevered_return_pct,latest_funding_accrued_usd"
      )
      .single();

    if (error) throw error;

    return {
      id: String(data.id),
      symbol: String(data.symbol),
      entryPrice: Number(data.entry_price),
      entryTsMs: Number(data.entry_ts_ms),
      signalHourVolume: Number(data.signal_hour_volume),
      leverage: Number(data.leverage),
      marginUsd: Number(data.margin_usd),
      notionalUsd: Number(data.notional_usd),
      entrySellRatio: Number(data.entry_sell_ratio),
      takeProfitPct: Number(data.take_profit_pct),
      deltaExitThreshold: Number(data.delta_exit_threshold),
      latestMarkPrice: Number(data.latest_mark_price),
      latestLeveragedReturnPct: Number(data.latest_leveraged_return_pct),
      latestUnleveredReturnPct: Number(data.latest_unlevered_return_pct),
      latestFundingAccruedUsd: Number(data.latest_funding_accrued_usd)
    };
  }

  async updatePositionMark(
    positionId: string,
    markPrice: number,
    tsMs: number,
    unleveredReturnPct: number,
    leveragedReturnPct: number,
    unrealizedPnlUsd: number,
    fundingAccruedUsd: number
  ): Promise<void> {
    const { error } = await this.db
      .from("xsp_positions")
      .update({
        latest_mark_price: markPrice,
        latest_mark_ts_ms: tsMs,
        latest_unlevered_return_pct: unleveredReturnPct,
        latest_leveraged_return_pct: leveragedReturnPct,
        latest_unrealized_pnl_usd: unrealizedPnlUsd,
        latest_funding_accrued_usd: fundingAccruedUsd,
        updated_at: new Date().toISOString()
      })
      .eq("id", positionId)
      .eq("status", "OPEN");

    if (error) throw error;
  }

  async closePosition(input: ClosePositionInput): Promise<void> {
    const { error: closeErr } = await this.db
      .from("xsp_positions")
      .update({
        status: "CLOSED",
        exit_ts_ms: input.exitTsMs,
        exit_price: input.exitPrice,
        exit_reason: input.exitReason,
        realized_unlevered_return_pct: input.unleveredReturnPct,
        realized_leveraged_return_pct: input.leveragedReturnPct,
        realized_pnl_usd: input.pnlUsd,
        fees_usd: input.feesUsd,
        slippage_usd: input.slippageUsd,
        net_funding_fee_usd: input.netFundingFeeUsd,
        updated_at: new Date().toISOString()
      })
      .eq("id", input.positionId)
      .eq("status", "OPEN");
    if (closeErr) throw closeErr;

    const { error: tradeErr } = await this.db.from("xsp_trades").insert({
      position_id: input.positionId,
      symbol: input.symbol,
      exit_ts_ms: input.exitTsMs,
      exit_price: input.exitPrice,
      exit_reason: input.exitReason,
      unlevered_return_pct: input.unleveredReturnPct,
      leveraged_return_pct: input.leveragedReturnPct,
      pnl_usd: input.pnlUsd,
      fees_usd: input.feesUsd,
      slippage_usd: input.slippageUsd,
      net_funding_fee_usd: input.netFundingFeeUsd
    });
    if (tradeErr) throw tradeErr;
  }

  async getOpenPositions(): Promise<OpenPositionRow[]> {
    const { data, error } = await this.db
      .from("xsp_positions")
      .select(
        "id,symbol,entry_price,entry_ts_ms,signal_hour_volume,leverage,margin_usd,notional_usd,entry_sell_ratio,take_profit_pct,delta_exit_threshold,latest_mark_price,latest_leveraged_return_pct,latest_unlevered_return_pct,latest_funding_accrued_usd"
      )
      .eq("status", "OPEN")
      .order("entry_ts_ms", { ascending: true });
    if (error) throw error;

    return (data ?? []).map((r) => ({
      id: String(r.id),
      symbol: String(r.symbol),
      entryPrice: Number(r.entry_price),
      entryTsMs: Number(r.entry_ts_ms),
      signalHourVolume: Number(r.signal_hour_volume),
      leverage: Number(r.leverage),
      marginUsd: Number(r.margin_usd),
      notionalUsd: Number(r.notional_usd),
      entrySellRatio: Number(r.entry_sell_ratio),
      takeProfitPct: Number(r.take_profit_pct),
      deltaExitThreshold: Number(r.delta_exit_threshold),
      latestMarkPrice: r.latest_mark_price === null ? null : Number(r.latest_mark_price),
      latestLeveragedReturnPct: r.latest_leveraged_return_pct === null ? null : Number(r.latest_leveraged_return_pct),
      latestUnleveredReturnPct: r.latest_unlevered_return_pct === null ? null : Number(r.latest_unlevered_return_pct),
      latestFundingAccruedUsd: r.latest_funding_accrued_usd === null ? null : Number(r.latest_funding_accrued_usd)
    }));
  }

  async getOpenPositionBySymbol(symbol: string): Promise<OpenPositionRow | null> {
    const { data, error } = await this.db
      .from("xsp_positions")
      .select(
        "id,symbol,entry_price,entry_ts_ms,signal_hour_volume,leverage,margin_usd,notional_usd,entry_sell_ratio,take_profit_pct,delta_exit_threshold,latest_mark_price,latest_leveraged_return_pct,latest_unlevered_return_pct,latest_funding_accrued_usd"
      )
      .eq("status", "OPEN")
      .eq("symbol", symbol)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
      id: String(data.id),
      symbol: String(data.symbol),
      entryPrice: Number(data.entry_price),
      entryTsMs: Number(data.entry_ts_ms),
      signalHourVolume: Number(data.signal_hour_volume),
      leverage: Number(data.leverage),
      marginUsd: Number(data.margin_usd),
      notionalUsd: Number(data.notional_usd),
      entrySellRatio: Number(data.entry_sell_ratio),
      takeProfitPct: Number(data.take_profit_pct),
      deltaExitThreshold: Number(data.delta_exit_threshold),
      latestMarkPrice: data.latest_mark_price === null ? null : Number(data.latest_mark_price),
      latestLeveragedReturnPct: data.latest_leveraged_return_pct === null ? null : Number(data.latest_leveraged_return_pct),
      latestUnleveredReturnPct: data.latest_unlevered_return_pct === null ? null : Number(data.latest_unlevered_return_pct),
      latestFundingAccruedUsd: data.latest_funding_accrued_usd === null ? null : Number(data.latest_funding_accrued_usd)
    };
  }

  async insertAlert(eventType: string, symbol: string, message: string, positionId: string | null, telegramMessageId: number | null): Promise<void> {
    const { error } = await this.db.from("xsp_alerts").insert({
      event_type: eventType,
      symbol,
      position_id: positionId,
      telegram_message_id: telegramMessageId,
      message_text: message
    });
    if (error) throw error;
  }

  async getRecentAlerts(limit = 5): Promise<Array<{ id: string; eventType: string; symbol: string; messageText: string; createdAt: string }>> {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const { data, error } = await this.db
      .from("xsp_alerts")
      .select("id,event_type,symbol,message_text,created_at")
      .order("created_at", { ascending: false })
      .limit(safeLimit);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: String(r.id),
      eventType: String(r.event_type),
      symbol: String(r.symbol),
      messageText: String(r.message_text ?? ""),
      createdAt: String(r.created_at ?? "")
    }));
  }

  async getSummary(startingEquityUsd: number): Promise<LiveSummary> {
    const { data, error } = await this.db.rpc("xsp_summary", { p_starting_equity_usd: startingEquityUsd });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return {
        entries: 0,
        liveEntries: 0,
        missedTrades: 0,
        winners: 0,
        losers: 0,
        liquidated: 0,
        replaced: 0,
        openPositions: 0,
        cashUsd: startingEquityUsd,
        marginInUseUsd: 0,
        openNotionalUsd: 0,
        unrealizedPnlUsd: 0,
        openFundingAccruedUsd: 0,
        realizedPnlUsd: 0,
        currentEquityUsd: startingEquityUsd,
        totalPnlUsd: 0,
        pnlPct: 0,
        winPct: 0
      };
    }

    return {
      entries: Number(row.entries ?? 0),
      liveEntries: Number(row.live_entries ?? 0),
      missedTrades: Number(row.missed_trades ?? 0),
      winners: Number(row.winners ?? 0),
      losers: Number(row.losers ?? 0),
      liquidated: Number(row.liquidated ?? 0),
      replaced: Number(row.replaced ?? 0),
      openPositions: Number(row.open_positions ?? 0),
      cashUsd: Number(row.cash_usd ?? startingEquityUsd),
      marginInUseUsd: Number(row.margin_in_use_usd ?? 0),
      openNotionalUsd: Number(row.open_notional_usd ?? 0),
      unrealizedPnlUsd: Number(row.unrealized_pnl_usd ?? 0),
      openFundingAccruedUsd: Number(row.open_funding_accrued_usd ?? 0),
      realizedPnlUsd: Number(row.realized_pnl_usd ?? 0),
      currentEquityUsd: Number(row.current_equity_usd ?? startingEquityUsd),
      totalPnlUsd: Number(row.total_pnl_usd ?? 0),
      pnlPct: Number(row.pnl_pct ?? 0),
      winPct: Number(row.win_pct ?? 0)
    };
  }

  async getCommandOpenRows(): Promise<Array<{ symbol: string; entry_price: number; leveraged_return_pct: number; entry_ts_ms: number }>> {
    const { data, error } = await this.db.rpc("xsp_open_positions_for_command");
    if (error) throw error;
    return ((Array.isArray(data) ? data : []) as Array<Record<string, unknown>>).map((r) => ({
      symbol: String(r.symbol),
      entry_price: Number(r.entry_price),
      leveraged_return_pct: Number(r.leveraged_return_pct),
      entry_ts_ms: Number(r.entry_ts_ms)
    }));
  }
}
