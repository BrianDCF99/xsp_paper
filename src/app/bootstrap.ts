import { loadConfig } from "../config/loadConfig.js";
import { BybitClient } from "../infra/bybit/client.js";
import { PaperStore } from "../infra/db/paperStore.js";
import { createSupabase } from "../infra/db/supabase.js";
import { TelegramClient } from "../infra/telegram/client.js";
import { Scheduler } from "../services/scheduler.js";
import { TelegramCommandService } from "../services/telegramCommandService.js";
import { XspV16PaperEngine } from "../strategy/v16/engine.js";
import { logger } from "../utils/logger.js";

export async function bootstrap(): Promise<{
  start: () => Promise<void>;
  stop: () => Promise<void>;
}> {
  const config = loadConfig();

  const supabase = createSupabase(config.supabase);
  const store = new PaperStore(supabase);
  const bybit = new BybitClient(config.bybit);
  const telegram = new TelegramClient(config.telegram, logger);
  const engine = new XspV16PaperEngine(config, bybit, store, telegram, logger);

  const scheduler = new Scheduler(config.app.scanIntervalMs, async () => {
    await engine.runCycle("timer");
  }, logger);

  const commands = new TelegramCommandService(config, store, telegram, engine, logger);

  await engine.bootstrap();

  return {
    start: async () => {
      logger.info("xsp_paper starting", {
        strategyId: config.strategy.id,
        version: config.app.version,
        scanIntervalMs: config.app.scanIntervalMs,
        telegramEnabled: config.telegram.enabled
      });

      // Run one cycle immediately, then continue with scheduler.
      await engine.runCycle("manual");
      scheduler.start();
      commands.start();
    },
    stop: async () => {
      scheduler.stop();
      commands.stop();
      logger.info("xsp_paper stopped");
    }
  };
}
