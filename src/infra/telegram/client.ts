import { AppConfig } from "../../config/schema.js";
import { Logger } from "../../utils/logger.js";

interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat?: { id?: number | string };
  };
}

export interface TelegramCommand {
  chatId: string;
  text: string;
}

export class TelegramClient {
  private readonly enabled: boolean;
  private readonly token: string;
  private readonly defaultChatId: string;
  private botUsernameCache: string | null | undefined;

  constructor(private readonly cfg: AppConfig["telegram"], private readonly logger: Logger) {
    this.enabled = cfg.enabled;
    this.token = cfg.botToken;
    this.defaultChatId = cfg.chatId;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async sendMessage(text: string, chatId?: string): Promise<number | null> {
    if (!this.enabled) return null;
    const target = chatId ?? this.defaultChatId;
    const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
    const payload = {
      chat_id: target,
      text,
      parse_mode: this.cfg.parseMode,
      disable_web_page_preview: true
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      this.logger.warn("Telegram send failed", { status: res.status, body });
      return null;
    }

    const json = (await res.json()) as { ok?: boolean; result?: { message_id?: number } };
    return json.result?.message_id ?? null;
  }

  async getUpdates(offset: number): Promise<TelegramUpdate[]> {
    if (!this.enabled) return [];
    const url = `https://api.telegram.org/bot${this.token}/getUpdates?timeout=0&allowed_updates=["message"]&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      this.logger.warn("Telegram getUpdates failed", { status: res.status, body });
      return [];
    }

    const json = (await res.json()) as { ok?: boolean; result?: TelegramUpdate[] };
    return json.result ?? [];
  }

  async getBotUsername(): Promise<string | null> {
    if (!this.enabled) return null;
    if (this.botUsernameCache !== undefined) return this.botUsernameCache;

    const url = `https://api.telegram.org/bot${this.token}/getMe`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        this.logger.warn("Telegram getMe failed", { status: res.status, body });
        this.botUsernameCache = null;
        return null;
      }
      const json = (await res.json()) as { ok?: boolean; result?: { username?: string } };
      const username = json.result?.username?.trim() ?? "";
      this.botUsernameCache = username.length > 0 ? username : null;
      return this.botUsernameCache;
    } catch (error) {
      this.logger.warn("Telegram getMe exception", { error: error instanceof Error ? error.message : String(error) });
      this.botUsernameCache = null;
      return null;
    }
  }

  extractCommands(updates: TelegramUpdate[]): TelegramCommand[] {
    const out: TelegramCommand[] = [];
    for (const u of updates) {
      const text = u.message?.text?.trim();
      const chatIdRaw = u.message?.chat?.id;
      if (!text || chatIdRaw === undefined || chatIdRaw === null) continue;
      if (!text.startsWith("/")) continue;
      out.push({
        chatId: String(chatIdRaw),
        text
      });
    }
    return out;
  }
}
