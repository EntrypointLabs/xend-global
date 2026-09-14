import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { UnifiedFiatService } from './unified.service';
/** Only advances the explicitly isolated simulator, never calls a financial provider. */
@Injectable()
export class UnifiedFiatWorker {
  private readonly logger = new Logger(UnifiedFiatWorker.name);
  private running = false;
  constructor(private readonly service: UnifiedFiatService) {}
  @Interval(3000)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.service.tickAuto();
    } catch {
      // No payloads, account numbers or credentials in logs. Next tick can resume.
      this.logger.warn('unified.simulation.tick_failed');
    } finally {
      this.running = false;
    }
  }
}
