import { eq } from 'drizzle-orm';
import type { DbService } from '../db/db.service';
import { squadsAccounts } from '../db/schema';

/**
 * The Consumer's vault, which is where their money is and what a Payment is
 * drawn from.
 *
 * Deliberately not the Privy wallet. That is S1, a signer on the vault, and it
 * holds nothing. Reading it here is what left Checkout measuring balance and
 * limits against an empty address once the Account became a Squads smart
 * account, so the two must not be confused again.
 *
 * Null means the Consumer has no Account yet, which is a Consumer who cannot
 * pay rather than one who is unknown.
 */
export async function findVaultAddress(
  db: DbService,
  consumerId: string,
): Promise<string | null> {
  const [account] = await db.client
    .select({ vaultAddress: squadsAccounts.vaultAddress })
    .from(squadsAccounts)
    .where(eq(squadsAccounts.userId, consumerId))
    .limit(1);
  return account?.vaultAddress ?? null;
}
