import { Injectable } from '@nestjs/common';

import { DbService } from '../db/db.service';
import { swaps } from '../db/schema';
import type { SwapRecord, SwapRecords } from './swap.interface';

@Injectable()
export class DrizzleSwapRecords implements SwapRecords {
  constructor(private readonly db: DbService) {}

  async record(swap: SwapRecord): Promise<void> {
    // A retried submit lands the same signature twice; the first row stands.
    await this.db.client.insert(swaps).values(swap).onConflictDoNothing();
  }
}
