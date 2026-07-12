import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import {
  apiKeys,
  merchants,
  payments,
  paymentIntents,
  webhookDeliveries,
  webhookEndpoints,
} from '../db/schema';

const LIST_LIMIT = 100;

export interface ConsolePaymentRow {
  id: string;
  merchantName: string | null;
  usdcAmount: string;
  ngnAmount: string | null;
  intentStatus: string | null;
  signature: string | null;
  settledAt: Date | null;
  refundOfPaymentId: string | null;
}

export interface ConsoleDeliveryRow {
  id: string;
  eventId: string;
  eventType: string;
  endpointUrl: string | null;
  attemptNo: number;
  status: string;
  responseStatus: number | null;
  durationMs: number | null;
  nextRetryAt: Date | null;
  createdAt: Date;
}

export interface ConsoleKeyRow {
  merchantName: string | null;
  fingerprint: string;
  mode: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/** Truncate a base58 signature to head…tail for display. */
function truncateSignature(sig: string | null): string | null {
  if (!sig) return null;
  if (sig.length <= 16) return sig;
  return `${sig.slice(0, 8)}…${sig.slice(-8)}`;
}

/**
 * Format raw minor units as a decimal string using BigInt division only
 * (never Number/parseFloat on amounts). Trailing zeros are trimmed:
 * formatMinor('50000000', 6) -> '50', formatMinor('1500000', 6) -> '1.5'.
 */
function formatMinor(amountRaw: string, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const value = BigInt(amountRaw);
  const whole = value / divisor;
  const fraction = value % divisor;
  if (fraction === 0n) return whole.toString();
  const fractionStr = fraction
    .toString()
    .padStart(decimals, '0')
    .replace(/0+$/, '');
  return `${whole.toString()}.${fractionStr}`;
}

export function formatUsdc(amountRaw: string): string {
  return formatMinor(amountRaw, 6);
}

export function formatNgn(amountMinor: string): string {
  return formatMinor(amountMinor, 2);
}

/**
 * Read-only console queries over the Pay tables (REQ-CONSOLE-READONLY). Every
 * query is newest-first and capped at 100 rows. No write path lives here; the
 * only mutation the console performs is Phase 6's manual webhook redelivery,
 * driven from the controller.
 */
@Injectable()
export class ConsoleService {
  constructor(private readonly db: DbService) {}

  async listPayments(): Promise<ConsolePaymentRow[]> {
    const rows = await this.db.client
      .select({
        id: payments.id,
        merchantName: merchants.displayName,
        usdcAmount: payments.usdcSettlementRaw,
        ngnAmount: payments.ngnDisplayMinor,
        intentStatus: paymentIntents.status,
        signature: payments.txSignature,
        settledAt: payments.settledAt,
        refundOfPaymentId: payments.refundOfPaymentId,
      })
      .from(payments)
      .leftJoin(merchants, eq(payments.merchantId, merchants.id))
      .leftJoin(paymentIntents, eq(payments.intentId, paymentIntents.id))
      .orderBy(desc(payments.createdAt), desc(payments.id))
      .limit(LIST_LIMIT);

    return rows.map((r) => ({
      id: r.id,
      merchantName: r.merchantName,
      usdcAmount: formatUsdc(r.usdcAmount),
      ngnAmount: r.ngnAmount ? formatNgn(r.ngnAmount) : null,
      intentStatus: r.intentStatus,
      signature: truncateSignature(r.signature),
      settledAt: r.settledAt,
      refundOfPaymentId: r.refundOfPaymentId,
    }));
  }

  async listDeliveries(): Promise<ConsoleDeliveryRow[]> {
    const rows = await this.db.client
      .select({
        id: webhookDeliveries.id,
        eventId: webhookDeliveries.eventId,
        eventType: webhookDeliveries.eventType,
        endpointUrl: webhookEndpoints.url,
        attemptNo: webhookDeliveries.attemptNo,
        status: webhookDeliveries.status,
        responseStatus: webhookDeliveries.responseStatus,
        durationMs: webhookDeliveries.durationMs,
        nextRetryAt: webhookDeliveries.nextRetryAt,
        createdAt: webhookDeliveries.createdAt,
      })
      .from(webhookDeliveries)
      .leftJoin(
        webhookEndpoints,
        eq(webhookDeliveries.endpointId, webhookEndpoints.id),
      )
      .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
      .limit(LIST_LIMIT);

    return rows;
  }

  async listKeyFingerprints(): Promise<ConsoleKeyRow[]> {
    const rows = await this.db.client
      .select({
        merchantName: merchants.displayName,
        fingerprint: apiKeys.fingerprint,
        mode: apiKeys.mode,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .leftJoin(merchants, eq(apiKeys.merchantId, merchants.id))
      .orderBy(desc(apiKeys.createdAt), desc(apiKeys.id))
      .limit(LIST_LIMIT);

    return rows;
  }
}
