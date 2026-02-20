import { LiveSummary, OpenPositionRow, StrategyMessageEvent } from "../../domain/types.js";
import { escapeHtml, fmtNum, fmtPct, fmtUsd, tickerLink } from "../../utils/format.js";
import { formatElapsedHhMm } from "../../utils/time.js";

export function formatSummaryBlock(summary: LiveSummary): string[] {
  return [
    "Totals:",
    `Entries: ${summary.entries}`,
    `Live Entries: ${summary.liveEntries}`,
    `Missed Trades: ${summary.missedTrades}`,
    `Winners: ${summary.winners}`,
    `Losers: ${summary.losers}`,
    `Liquidated: ${summary.liquidated}`,
    `Replaced: ${summary.replaced}`,
    `Open Positions: ${summary.openPositions}`,
    `Current Equity: ${fmtUsd(summary.currentEquityUsd)}`,
    `Cash: ${fmtUsd(summary.cashUsd)}`,
    `Margin In Use: ${fmtUsd(summary.marginInUseUsd)}`,
    `Open Notional: ${fmtUsd(summary.openNotionalUsd)}`,
    `Unrealized PnL: ${fmtUsd(summary.unrealizedPnlUsd)}`,
    `Open Funding Accrued: ${fmtUsd(summary.openFundingAccruedUsd)}`,
    `PnL (vs start): ${fmtPct(summary.pnlPct)} | ${fmtUsd(summary.totalPnlUsd)}`,
    `Win %: ${summary.winPct.toFixed(2)}%`
  ];
}

export function formatEntryMessage(title: string, event: StrategyMessageEvent, summary: LiveSummary): string {
  const safeTitle = escapeHtml(title);
  const lines = [
    `🚨 <b>${safeTitle}</b>`,
    "",
    event.type === "ENTRY_REPLACE_OPEN_SHORT" ? "♻️ <b>ENTRY REPLACE SHORT</b>" : "📉 <b>ENTRY OPEN SHORT</b>",
    tickerLink(event.symbol),
    `Entry Cond 1: Sell Ratio ≤ ${fmtNum(event.sellRatioThreshold ?? 0, 3)} (now ${fmtNum(event.sellRatio ?? 0, 3)})`,
    `Entry Cond 2: 1h Volume ≥ ${fmtNum(event.volumeThreshold ?? 0, 0)} (now ${fmtNum(event.hourVolume ?? 0, 0)})`,
    `Entry Price: ${fmtUsd(event.entryPrice ?? 0)}`,
    `Take Profit Price: ${fmtUsd(event.takeProfitPrice ?? 0)}`,
    `Realized Entry Slippage: ${fmtNum(event.entrySlippageBps ?? 0, 2)} bps`
  ];

  if (event.type === "ENTRY_REPLACE_OPEN_SHORT" && event.replacedSymbol) {
    lines.push(`Old Ticker: ${tickerLink(event.replacedSymbol)}`);
    lines.push(`Old Trade PnL: ${fmtPct(event.replacedPnlPct ?? 0)}`);
    lines.push(`Old Trade Unlev: ${fmtPct(event.replacedUnleveredPct ?? 0)}`);
  }

  lines.push("", ...formatSummaryBlock(summary));
  return lines.join("\n");
}

export function formatExitMessage(title: string, event: StrategyMessageEvent, summary: LiveSummary): string {
  const safeTitle = escapeHtml(title);
  const header =
    event.exitReason === "TP"
      ? "✅ <b>EXIT TP</b>"
      : event.exitReason === "DELTA"
        ? "📈 <b>EXIT DELTA</b>"
        : event.exitReason === "TIME"
          ? "⏱️ <b>EXIT TIME</b>"
          : event.exitReason === "LIQ"
            ? "🟥 <b>EXIT LIQUIDATED</b>"
            : "♻️ <b>EXIT REPLACE</b>";

  return [
    `🚨 <b>${safeTitle}</b>`,
    "",
    header,
    tickerLink(event.symbol),
    `PnL: ${fmtPct(event.leveragedReturnPct ?? 0)}`,
    `Leverage: ${fmtNum(event.leverage ?? 0, 2)}x | Unlev: ${fmtPct(event.unleveredReturnPct ?? 0)}`,
    `Realized Exit Slippage: ${fmtNum(event.exitSlippageBps ?? 0, 2)} bps`,
    `Realized Roundtrip Slippage: ${fmtNum((event.entrySlippageBps ?? 0) + (event.exitSlippageBps ?? 0), 2)} bps`,
    `Net funding fee: ${fmtUsd(event.netFundingFeeUsd ?? 0)}`,
    "",
    ...formatSummaryBlock(summary)
  ].join("\n");
}

export function formatXspCommand(title: string, summary: LiveSummary, rows: OpenPositionRow[], nowTsMs: number): string {
  const safeTitle = escapeHtml(title);
  const lines: string[] = [
    `🎯 <b>${safeTitle}</b>`,
    "Exchange: BYBIT",
    "Scope: global strategy tracking only",
    `Tracked coins: ${rows.length}`,
    "",
    "📉 Open Positions",
    "",
    "Ticker | Price at alert | pnl% | time since alert",
    "",
    `<b>OPEN SHORT</b> - Open Positions: ${rows.length}`
  ];

  if (rows.length === 0) {
    lines.push("(none)");
  } else {
    rows.forEach((r, i) => {
      lines.push(
        `${i + 1}. ${tickerLink(r.symbol)} | ${fmtUsd(r.entryPrice)} | ${fmtPct(r.latestLeveragedReturnPct ?? 0)} | ${formatElapsedHhMm(
          r.entryTsMs,
          nowTsMs
        )}`
      );
    });
  }

  lines.push("", "📊 Live Totals", ...formatSummaryBlock(summary));
  return lines.join("\n");
}

export function formatFundingEventMessage(title: string, symbol: string, fundingDeltaUsd: number, pointsCount: number): string {
  const safeTitle = escapeHtml(title);
  const flow = fundingDeltaUsd >= 0 ? "coming in" : "leaving";
  return [
    `🚨 <b>${safeTitle}</b>`,
    "",
    "💸 <b>FUNDING UPDATE</b>",
    tickerLink(symbol),
    `Net Funding: ${fmtUsd(fundingDeltaUsd)} (${flow})`,
    `Settlements in update: ${fmtNum(pointsCount, 0)}`
  ].join("\n");
}
