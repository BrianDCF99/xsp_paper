import { AppConfig } from "../config/schema.js";
import { OpenPositionRow } from "../domain/types.js";
import { PaperStore } from "../infra/db/paperStore.js";
import { TelegramClient } from "../infra/telegram/client.js";
import { Logger } from "../utils/logger.js";
import { formatInfoCommand, formatXspCommand } from "../strategy/v16/messages.js";

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

    if (command === "/xsp") {
      const summary = await this.store.getSummary(this.cfg.strategy.startingEquityUsd);
      const open = await this.store.getOpenPositions();
      const message = formatXspCommand(this.cfg.strategy.title, summary, open, Date.now());
      await this.telegram.sendMessage(message, chatId);
      return;
    }

    if (command === "/info") {
      const requested = (parts[1] ?? "").toLowerCase();
      const aliases = new Set([
        "xsp",
        "xsp-paper",
        "xsp_paper",
        this.cfg.strategy.id.toLowerCase(),
        this.cfg.strategy.title.toLowerCase().replaceAll(" ", "")
      ]);
      if (requested && !aliases.has(requested)) {
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

    if (command === "/help" || command === "/start") {
      await this.telegram.sendMessage(["Available commands:", "/xsp", "/info <strategyName>", "/scan", "/alerts", "/help"].join("\n"), chatId);
      return;
    }
  }
}
