import { AppConfig } from "../config/schema.js";
import { OpenPositionRow } from "../domain/types.js";
import { PaperStore } from "../infra/db/paperStore.js";
import { TelegramClient } from "../infra/telegram/client.js";
import { Logger } from "../utils/logger.js";
import { formatCoinSummary, formatInfoCommand, formatXspCommand, formatXspOpenTrades } from "../strategy/v16/messages.js";

function formatErrorMeta(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const out: Record<string, unknown> = {
      name: error.name,
      message: error.message
    };
    if (error.stack) out.stack = error.stack;
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause !== undefined) out.cause = typeof cause === "object" ? JSON.stringify(cause) : String(cause);
    return out;
  }

  if (typeof error === "object" && error !== null) {
    let serialized = "";
    try {
      serialized = JSON.stringify(error);
    } catch {
      serialized = String(error);
    }
    return { errorType: "object", error: serialized };
  }

  return { errorType: typeof error, error: String(error) };
}

export interface ScanTrigger {
  runCycle(trigger: "timer" | "manual"): Promise<{ executed: boolean; reason?: string }>;
}

export class TelegramCommandService {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly cfg: AppConfig,
    private readonly store: PaperStore,
    private readonly telegram: TelegramClient,
    private readonly scanTrigger: ScanTrigger,
    private readonly logger: Logger
  ) {}

  start(): void {
    if (!this.telegram.isEnabled()) return;
    this.timer = setInterval(() => {
      this.pollOnce().catch((error) => {
        this.logger.warn("telegram poll failed", formatErrorMeta(error));
      });
    }, this.cfg.telegram.commandPollMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async pollOnce(): Promise<void> {
    const key = `${this.cfg.strategy.id}:telegram_offset`;
    const offsetRaw = await this.store.getRuntimeValue(key);
    let offset = Number(offsetRaw ?? "0") || 0;

    const updates = await this.telegram.getUpdates(offset);
    if (updates.length === 0) return;

    for (const u of updates) {
      offset = Math.max(offset, (u.update_id ?? 0) + 1);
    }

    await this.store.setRuntimeValue(key, String(offset));

    const commands = this.telegram.extractCommands(updates);
    for (const cmd of commands) {
      await this.handleCommand(cmd.text.trim(), cmd.chatId);
    }
  }

  private async handleCommand(text: string, chatId: string): Promise<void> {
    const parts = text.split(/\s+/).filter(Boolean);
    const command = parts[0]?.toLowerCase() ?? "";
    const arg1 = (parts[1] ?? "").trim();

    const normalizeSymbol = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9_]/g, "");
    const findOpenBySymbol = (rows: OpenPositionRow[], symbolInput: string): OpenPositionRow | null => {
      const want = normalizeSymbol(symbolInput);
      if (!want) return null;
      return rows.find((r) => normalizeSymbol(r.symbol) === want) ?? null;
    };

    const sendCoinSummary = async (symbolInput: string): Promise<boolean> => {
      const open = await this.store.getOpenPositions();
      const row = findOpenBySymbol(open, symbolInput);
      if (!row) {
        await this.telegram.sendMessage(`No open trade found for ${normalizeSymbol(symbolInput)}.`, chatId);
        return true;
      }
      await this.telegram.sendMessage(formatCoinSummary(this.cfg.strategy.title, row, Date.now()), chatId);
      return true;
    };

    if (command === "/xsp") {
      const open = await this.store.getOpenPositions();
      const subcommand = arg1.toLowerCase();
      if (subcommand === "open") {
        const botUsername = await this.telegram.getBotUsername();
        const message = formatXspOpenTrades(this.cfg.strategy.title, open, (symbol) => {
          if (!botUsername) return null;
          return `https://t.me/${botUsername}?start=xsp_${encodeURIComponent(symbol)}`;
        });
        await this.telegram.sendMessage(message, chatId);
        return;
      }

      if (arg1 && !arg1.startsWith("-")) {
        await sendCoinSummary(arg1);
        return;
      }

      const summary = await this.store.getSummary(this.cfg.strategy.startingEquityUsd);
      const message = formatXspCommand(this.cfg.strategy.title, summary, open, Date.now());
      await this.telegram.sendMessage(message, chatId);
      return;
    }

    if (command === "/info") {
      const requested = (parts[1] ?? "").toLowerCase().trim();
      if (!requested) {
        await this.telegram.sendMessage("Usage: /info <strategyName> (e.g. /info xsp)", chatId);
        return;
      }

      const aliases = new Set([
        "xsp",
        "xsp-paper",
        "xsp_paper",
        this.cfg.strategy.id.toLowerCase(),
        this.cfg.strategy.id.toLowerCase().replaceAll(":", ""),
        this.cfg.strategy.title.toLowerCase().replaceAll(" ", "")
      ]);

      if (!aliases.has(requested)) {
        await this.telegram.sendMessage(
          `Unknown strategy '${requested}'. Try: /info xsp`,
          chatId
        );
        return;
      }
      const message = formatInfoCommand(this.cfg.strategy.title, {
        leverage: this.cfg.strategy.leverage,
        entryMarginFraction: this.cfg.strategy.entryMarginFraction,
        entryMarginCapUsd: this.cfg.strategy.entryMarginCapUsd,
        sellRatioMax: this.cfg.strategy.sellRatioMax,
        minHourVolume: this.cfg.strategy.minHourVolume,
        takeProfitPct: this.cfg.strategy.takeProfitPct,
        deltaExitThreshold: this.cfg.strategy.deltaExitThreshold,
        maxHoldHours: this.cfg.strategy.maxHoldHours,
        replaceThresholdPct: this.cfg.strategy.replaceThresholdPct,
        replaceThresholdBasis: this.cfg.strategy.replaceThresholdBasis
      });
      await this.telegram.sendMessage(message, chatId);
      return;
    }

    if (command === "/scan") {
      await this.telegram.sendMessage("Manual scan requested. Running now...", chatId);
      const result = await this.scanTrigger.runCycle("manual");
      if (!result.executed) {
        await this.telegram.sendMessage(`Manual scan skipped (${result.reason ?? "unknown"}).`, chatId);
        return;
      }
      await this.telegram.sendMessage("Manual scan complete.", chatId);
      return;
    }

    if (command === "/alerts") {
      const rows = await this.store.getRecentAlerts(5);
      if (rows.length === 0) {
        await this.telegram.sendMessage("No alerts found in DB yet.", chatId);
        return;
      }

      await this.telegram.sendMessage(`Resending last ${rows.length} alert${rows.length === 1 ? "" : "s"}...`, chatId);
      for (const row of [...rows].reverse()) {
        const sanitized = row.messageText.replaceAll("<=", "≤").replaceAll(">=", "≥");
        await this.telegram.sendMessage(sanitized, chatId);
      }
      return;
    }

    if (command === "/start") {
      const payload = arg1;
      if (payload.toLowerCase().startsWith("xsp_")) {
        const symbolFromPayload = payload.slice(4);
        if (symbolFromPayload) {
          await sendCoinSummary(symbolFromPayload);
          return;
        }
      }
    }

    if (command === "/help" || command === "/start") {
      await this.telegram.sendMessage(
        ["Available commands:", "/xsp", "/xsp open", "/xsp <ticker>", "/info <strategyName>", "/scan", "/alerts", "/help"].join("\n"),
        chatId
      );
      return;
    }
  }
}
