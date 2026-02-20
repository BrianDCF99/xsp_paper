import { AppConfig } from "../../config/schema.js";
import { V16SignalDecision } from "../../domain/types.js";
import { BybitClient } from "../../infra/bybit/client.js";
import { HOUR_MS } from "../../utils/time.js";

export class V16SignalDetector {
  constructor(private readonly bybit: BybitClient, private readonly cfg: AppConfig["strategy"]) {}

  async detect(symbol: string): Promise<V16SignalDecision | null> {
    const klines = await this.bybit.getKlines1h(symbol, 3);
    if (klines.length < 2) return null;

    // Close-confirm/open-entry: use last fully closed candle for confirmation.
    const closed = klines[klines.length - 2];
    const current = klines[klines.length - 1];

    if (!closed || !current || closed.openTimeMs >= current.openTimeMs) return null;

    const closedHourStartMs = closed.openTimeMs;
    const closedHourEndMs = closedHourStartMs + HOUR_MS;

    if (!(Number.isFinite(closed.volume) && closed.volume >= this.cfg.minHourVolume)) {
      return null;
    }

    const ratios = await this.bybit.getAccountRatio1h(symbol, 10);
    const ratioPoint = ratios
      .filter((r) => r.tsMs <= closedHourEndMs && r.tsMs >= closedHourStartMs - HOUR_MS)
      .sort((a, b) => a.tsMs - b.tsMs)
      .at(-1);

    const sellRatio = ratioPoint?.sellRatio ?? null;
    if (sellRatio === null || !Number.isFinite(sellRatio) || sellRatio > this.cfg.sellRatioMax) return null;

    const nextOpenPrice = current.open;
    if (!Number.isFinite(nextOpenPrice) || nextOpenPrice <= 0) return null;

    return {
      symbol,
      closedHourStartMs,
      closedHourEndMs,
      closedHourVolume: closed.volume,
      signalSellRatio: sellRatio,
      closePrice: closed.close,
      nextOpenPrice
    };
  }
}
