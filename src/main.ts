import { bootstrap } from "./app/bootstrap.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  const app = await bootstrap();
  await app.start();

  const shutdown = async (signal: string) => {
    logger.info("shutdown signal", { signal });
    await app.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  logger.error("fatal", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
