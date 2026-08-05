import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { apiKeys, merchants } from '../db/schema';

const LIST_LIMIT = 100;

export interface CreatedTestMerchant {
  id: string;
  kybStatus: string;
}

export interface TestMerchantRow {
  merchantId: string;
  displayName: string | null;
  fingerprint: string;
  mode: string;
  kybStatus: string | null;
}

/**
 * DB reads and the Merchant-row insert for the local test dashboard. Key
 * issuance itself stays in KeyIssuanceService (the single issuance path the
 * ops script also drives), so the dashboard can never drift from it.
 */
@Injectable()
export class TestDashboardService {
  constructor(private readonly db: DbService) {}

  async createMerchant(name: string): Promise<CreatedTestMerchant> {
    const [created] = await this.db.client
      .insert(merchants)
      .values({ name, displayName: name })
      .returning({ id: merchants.id, kybStatus: merchants.kybStatus });
    return created;
  }

  /** One row per test-mode key, newest first, with the owning Merchant. */
  async listTestMerchants(): Promise<TestMerchantRow[]> {
    return this.db.client
      .select({
        merchantId: apiKeys.merchantId,
        displayName: merchants.displayName,
        fingerprint: apiKeys.fingerprint,
        mode: apiKeys.mode,
        kybStatus: merchants.kybStatus,
      })
      .from(apiKeys)
      .leftJoin(merchants, eq(apiKeys.merchantId, merchants.id))
      .where(eq(apiKeys.mode, 'test'))
      .orderBy(desc(apiKeys.createdAt), desc(apiKeys.id))
      .limit(LIST_LIMIT);
  }
}
