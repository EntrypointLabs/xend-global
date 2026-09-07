import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { adminAuditLog } from '../db/schema';

export type AdminAction =
  | 'recovery.freeze'
  | 'recovery.unfreeze'
  | 'webhook.redeliver'
  | 'api_key.issue'
  | 'api_key.revoke'
  | 'auth.console.failed'
  | 'auth.internal.failed';

export const AUDIT_EVENTS = Symbol('AUDIT_EVENTS');

/**
 * The audit calls other modules make without depending on the console.
 *
 * Provide it as `{ provide: AUDIT_EVENTS, useClass: AdminAuditService }`
 * wherever it is needed; the service reaches only the global DbService.
 */
export interface AuditEvents {
  apiKeyIssued(actor: string, merchantId: string, keyId: string): Promise<void>;
  apiKeyRevoked(actor: string, keyId: string): Promise<void>;
  /** A rejected credential on an internal surface; `source` names the caller. */
  authFailed(surface: 'console' | 'internal', source: string): Promise<void>;
}

/** Append-only record of every operator write and every refused operator credential. */
@Injectable()
export class AdminAuditService implements AuditEvents {
  constructor(private readonly db: DbService) {}

  async record(
    actor: string,
    action: AdminAction,
    target: string,
  ): Promise<void> {
    await this.db.client.insert(adminAuditLog).values({
      actor,
      action,
      target,
    });
  }

  apiKeyIssued(
    actor: string,
    merchantId: string,
    keyId: string,
  ): Promise<void> {
    return this.record(actor, 'api_key.issue', `${merchantId}/${keyId}`);
  }

  apiKeyRevoked(actor: string, keyId: string): Promise<void> {
    return this.record(actor, 'api_key.revoke', keyId);
  }

  authFailed(surface: 'console' | 'internal', source: string): Promise<void> {
    return this.record('anonymous', `auth.${surface}.failed`, source);
  }
}
