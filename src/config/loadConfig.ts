import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import YAML from "yaml";
import { AppConfig, FileConfigSchema, SecretEnvSchema } from "./schema.js";

dotenv.config();

export function loadConfig(): AppConfig {
  const configPath = path.resolve(process.cwd(), "config", "config.yaml");
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing config file: ${configPath}`);
  }

  const rawYaml = fs.readFileSync(configPath, "utf8");
  const yamlData = YAML.parse(rawYaml);
  const parsedFile = FileConfigSchema.parse(yamlData);
  const env = SecretEnvSchema.parse(process.env);

  if (parsedFile.telegram.enabled && (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID)) {
    throw new Error("Telegram is enabled in config.yaml but TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are missing in .env");
  }

  return {
    app: {
      env: env.NODE_ENV ?? "development",
      version: parsedFile.app.version,
      scanIntervalMs: parsedFile.app.scanIntervalMs,
      symbolRefreshIntervalMs: parsedFile.app.symbolRefreshIntervalMs
    },
    supabase: {
      url: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      schema: env.SUPABASE_SCHEMA
    },
    bybit: parsedFile.bybit,
    telegram: {
      enabled: parsedFile.telegram.enabled,
      botToken: env.TELEGRAM_BOT_TOKEN ?? "",
      chatId: env.TELEGRAM_CHAT_ID ?? "",
      parseMode: parsedFile.telegram.parseMode,
      commandPollMs: parsedFile.telegram.commandPollMs
    },
    strategy: parsedFile.strategy,
    costs: parsedFile.costs,
    funding: parsedFile.funding
  };
}
