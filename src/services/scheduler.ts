import { Logger } from "../utils/logger.js";

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly everyMs: number,
    private readonly fn: () => Promise<void>,
    private readonly logger: Logger
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      this.fn().catch((error) => {
        this.logger.error("scheduled task failed", { error: error instanceof Error ? error.message : String(error) });
      });
    }, this.everyMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
