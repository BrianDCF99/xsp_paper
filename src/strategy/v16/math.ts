import { AppConfig } from "../../config/schema.js";

export interface CostBreakdown {
  entryFeeUsd: number;
  exitFeeUsd: number;
  entrySlippageUsd: number;
  exitSlippageUsd: number;
  totalFeesUsd: number;
  totalSlippageUsd: number;
  totalCostUsd: number;
}

export interface CostOverrides {
  takerFeeBps?: number;
  entrySlippageBps?: number;
  exitSlippageBps?: number;
}

export function shortUnleveredReturnPct(entryPrice: number, exitPrice: number): number {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(exitPrice) || exitPrice <= 0) return 0;
  return ((entryPrice - exitPrice) / entryPrice) * 100;
}

export function leveragedReturnPct(unleveredReturnPct: number, leverage: number): number {
  return unleveredReturnPct * leverage;
}

export function qtyFromNotional(notionalUsd: number, entryPrice: number): number {
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0 || !Number.isFinite(entryPrice) || entryPrice <= 0) return 0;
  return notionalUsd / entryPrice;
}

export function pnlUsdFromUnleveredPct(marginUsd: number, leverage: number, unleveredReturnPctValue: number): number {
  if (!Number.isFinite(marginUsd) || !Number.isFinite(leverage) || !Number.isFinite(unleveredReturnPctValue)) return 0;
  return marginUsd * leverage * (unleveredReturnPctValue / 100);
}

export function applyCosts(
  notionalUsd: number,
  cfg: AppConfig["costs"],
  _entry: number,
  _exit: number,
  overrides?: CostOverrides
): CostBreakdown {
  const takerFeeBps = overrides?.takerFeeBps ?? cfg.takerFeeBps;
  const entrySlippageBps = overrides?.entrySlippageBps ?? cfg.entrySlippageBps;
  const exitSlippageBps = overrides?.exitSlippageBps ?? cfg.exitSlippageBps;

  const entryFeeUsd = cfg.useFees ? notionalUsd * (takerFeeBps / 10_000) : 0;
  const exitFeeUsd = cfg.useFees ? notionalUsd * (takerFeeBps / 10_000) : 0;

  const entrySlipPct = cfg.useSlippage ? entrySlippageBps / 10_000 : 0;
  const exitSlipPct = cfg.useSlippage ? exitSlippageBps / 10_000 : 0;

  // For a short: worse entry is lower fill; worse exit is higher buyback.
  const entrySlippageUsd = cfg.useSlippage ? notionalUsd * entrySlipPct : 0;
  const exitSlippageUsd = cfg.useSlippage ? notionalUsd * exitSlipPct : 0;

  const totalFeesUsd = entryFeeUsd + exitFeeUsd;
  const totalSlippageUsd = entrySlippageUsd + exitSlippageUsd;
  return {
    entryFeeUsd,
    exitFeeUsd,
    entrySlippageUsd,
    exitSlippageUsd,
    totalFeesUsd,
    totalSlippageUsd,
    totalCostUsd: totalFeesUsd + totalSlippageUsd
  };
}

export function liquidationThresholdUnleveredPct(leverage: number): number {
  if (!Number.isFinite(leverage) || leverage <= 0) return -100;
  return -(100 / leverage);
}
