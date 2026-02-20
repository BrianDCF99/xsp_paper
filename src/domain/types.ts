export interface BybitInstrument {
  symbol: string;
  status: string;
  contractType: string;
  quoteCoin?: string;
  settleCoin?: string;
}

export interface HourKline {
  openTimeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SellRatioPoint {
  tsMs: number;
  buyRatio: number | null;
  sellRatio: number | null;
}

export interface TickerSnapshot {
  symbol: string;
  markPrice: number;
  lastPrice: number;
  bid1Price: number | null;
  ask1Price: number | null;
}

export interface FundingPoint {
  tsMs: number;
  fundingRate: number;
}

export interface V16SignalDecision {
  symbol: string;
  closedHourStartMs: number;
  closedHourEndMs: number;
  closedHourVolume: number;
  signalSellRatio: number;
  closePrice: number;
  nextOpenPrice: number;
}

export type SignalOutcome =
  | "OPENED"
  | "OPENED_REPLACEMENT"
  | "MISSED_DUPLICATE"
  | "MISSED_CAPACITY"
  | "MISSED_NO_CASH"
  | "MISSED_INVALID_PRICE"
  | "SKIPPED_ALREADY_PROCESSED";

export type ExitReason = "TP" | "DELTA" | "TIME" | "LIQ" | "REPLACE";

export interface PositionMark {
  symbol: string;
  markPrice: number;
  unleveredReturnPct: number;
  leveragedReturnPct: number;
  unrealizedPnlUsd: number;
  tsMs: number;
}

export interface LiveSummary {
  entries: number;
  liveEntries: number;
  missedTrades: number;
  winners: number;
  losers: number;
  liquidated: number;
  replaced: number;
  openPositions: number;
  cashUsd: number;
  marginInUseUsd: number;
  openNotionalUsd: number;
  unrealizedPnlUsd: number;
  realizedPnlUsd: number;
  currentEquityUsd: number;
  totalPnlUsd: number;
  pnlPct: number;
  winPct: number;
}

export interface OpenPositionRow {
  id: string;
  symbol: string;
  entryPrice: number;
  entryTsMs: number;
  leverage: number;
  marginUsd: number;
  notionalUsd: number;
  entrySellRatio: number;
  takeProfitPct: number;
  deltaExitThreshold: number;
  latestMarkPrice: number | null;
  latestLeveragedReturnPct: number | null;
  latestUnleveredReturnPct: number | null;
}

export interface StrategyMessageEvent {
  type: "ENTRY_OPEN_SHORT" | "ENTRY_REPLACE_OPEN_SHORT" | "EXIT";
  symbol: string;
  entryPrice?: number;
  takeProfitPrice?: number;
  sellRatio?: number;
  sellRatioThreshold?: number;
  hourVolume?: number;
  volumeThreshold?: number;
  replacedSymbol?: string;
  replacedPnlPct?: number;
  replacedUnleveredPct?: number;
  exitReason?: ExitReason;
  leveragedReturnPct?: number;
  unleveredReturnPct?: number;
  leverage?: number;
  netFundingFeeUsd?: number;
}
