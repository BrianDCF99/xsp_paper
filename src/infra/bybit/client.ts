import { AppConfig } from "../../config/schema.js";
import { BybitInstrument, FundingPoint, HourKline, SellRatioPoint, TickerSnapshot } from "../../domain/types.js";

function parseNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function parseNullableNum(v: unknown): number | null {
  const n = parseNum(v);
  return Number.isFinite(n) && n !== 0 ? n : (typeof v === "string" && v.trim() === "0" ? 0 : null);
}

export class BybitClient {
  constructor(private readonly cfg: AppConfig["bybit"]) {}

  private async getJson(path: string): Promise<unknown> {
    const url = `${this.cfg.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async getLinearPerpSymbols(limit = 1000): Promise<BybitInstrument[]> {
    const raw = (await this.getJson(
      `/v5/market/instruments-info?category=${this.cfg.category}&limit=${Math.max(1, Math.min(limit, 1000))}`
    )) as { result?: { list?: Array<Record<string, unknown>> } };

    const list = raw.result?.list ?? [];
    return list
      .map((r) => ({
        symbol: String(r.symbol ?? "").trim().toUpperCase(),
        status: String(r.status ?? ""),
        contractType: String(r.contractType ?? ""),
        quoteCoin: typeof r.quoteCoin === "string" ? r.quoteCoin : undefined,
        settleCoin: typeof r.settleCoin === "string" ? r.settleCoin : undefined
      }))
      .filter((r) => r.symbol && r.contractType.toLowerCase().includes("perpetual") && r.quoteCoin?.toUpperCase() === "USDT");
  }

  async getKlines1h(symbol: string, limit: number): Promise<HourKline[]> {
    const raw = (await this.getJson(
      `/v5/market/kline?category=${this.cfg.category}&symbol=${encodeURIComponent(symbol)}&interval=60&limit=${Math.max(1, Math.min(limit, 200))}`
    )) as { result?: { list?: string[][] } };
    const rows = raw.result?.list ?? [];
    return rows
      .map((r) => ({
        openTimeMs: Number(r[0] ?? 0),
        open: parseNum(r[1]),
        high: parseNum(r[2]),
        low: parseNum(r[3]),
        close: parseNum(r[4]),
        volume: parseNum(r[5])
      }))
      .filter((r) => Number.isFinite(r.openTimeMs) && r.openTimeMs > 0)
      .sort((a, b) => a.openTimeMs - b.openTimeMs);
  }

  async getAccountRatio1h(symbol: string, limit = 10): Promise<SellRatioPoint[]> {
    const raw = (await this.getJson(
      `/v5/market/account-ratio?category=${this.cfg.category}&symbol=${encodeURIComponent(symbol)}&period=1h&limit=${Math.max(1, Math.min(limit, 200))}`
    )) as { result?: { list?: Array<Record<string, unknown>> } };

    const list = raw.result?.list ?? [];
    return list
      .map((r) => ({
        tsMs: Number(r.timestamp ?? 0),
        buyRatio: parseNullableNum(r.buyRatio),
        sellRatio: parseNullableNum(r.sellRatio)
      }))
      .filter((r) => Number.isFinite(r.tsMs) && r.tsMs > 0)
      .sort((a, b) => a.tsMs - b.tsMs);
  }

  async getTicker(symbol: string): Promise<TickerSnapshot | null> {
    const raw = (await this.getJson(
      `/v5/market/tickers?category=${this.cfg.category}&symbol=${encodeURIComponent(symbol)}`
    )) as { result?: { list?: Array<Record<string, unknown>> } };
    const row = raw.result?.list?.[0];
    if (!row) return null;
    return {
      symbol: String(row.symbol ?? symbol).toUpperCase(),
      markPrice: parseNum(row.markPrice),
      lastPrice: parseNum(row.lastPrice),
      bid1Price: parseNullableNum(row.bid1Price),
      ask1Price: parseNullableNum(row.ask1Price)
    };
  }

  async getTickers(): Promise<TickerSnapshot[]> {
    const raw = (await this.getJson(`/v5/market/tickers?category=${this.cfg.category}`)) as {
      result?: { list?: Array<Record<string, unknown>> };
    };
    const list = raw.result?.list ?? [];
    return list.map((row) => ({
      symbol: String(row.symbol ?? "").toUpperCase(),
      markPrice: parseNum(row.markPrice),
      lastPrice: parseNum(row.lastPrice),
      bid1Price: parseNullableNum(row.bid1Price),
      ask1Price: parseNullableNum(row.ask1Price)
    }));
  }

  async getFundingHistory(symbol: string, startMs: number, endMs: number, limit = 200): Promise<FundingPoint[]> {
    const s = Math.max(0, Math.floor(startMs));
    const e = Math.max(s, Math.floor(endMs));
    const raw = (await this.getJson(
      `/v5/market/funding/history?category=${this.cfg.category}&symbol=${encodeURIComponent(symbol)}&startTime=${s}&endTime=${e}&limit=${Math.max(1, Math.min(limit, 200))}`
    )) as { result?: { list?: Array<Record<string, unknown>> } };

    const rows = raw.result?.list ?? [];
    return rows
      .map((r) => ({
        tsMs: Number(r.fundingRateTimestamp ?? 0),
        fundingRate: parseNum(r.fundingRate)
      }))
      .filter((r) => Number.isFinite(r.tsMs) && r.tsMs > 0 && Number.isFinite(r.fundingRate))
      .sort((a, b) => a.tsMs - b.tsMs);
  }
}
