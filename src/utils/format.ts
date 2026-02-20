export function fmtNum(v: number, max = 2): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: max });
}

export function fmtUsd(v: number): string {
  const sign = v >= 0 ? "" : "-";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
}

export function fmtPct(v: number, digits = 2): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

export function bybitTickerUrl(symbol: string): string {
  return `https://www.bybit.com/trade/usdt/${encodeURIComponent(symbol)}`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function tickerLink(symbol: string): string {
  return `<b><a href="${escapeHtml(bybitTickerUrl(symbol))}">${escapeHtml(symbol)}</a></b>`;
}
