import type { apiKeys, webhookEndpoints } from '../db/schema';
import type { OwnedMerchant } from './merchant-owner.service';

type ApiKeyRow = typeof apiKeys.$inferSelect;
type EndpointRow = typeof webhookEndpoints.$inferSelect;

/**
 * The owner-facing Merchant view. Owner identity, the raw provider id and any
 * server-only column are deliberately dropped: the portal returns the
 * Merchant's own business data, never the credential that authenticates it.
 */
export function toMerchantView(merchant: OwnedMerchant) {
  return {
    id: merchant.id,
    name: merchant.name,
    displayName: merchant.displayName,
    signInEmail: merchant.signInEmail,
    status: merchant.status,
    receivingWallet: merchant.receivingWallet,
    allowedOrigins: merchant.allowedOrigins,
    kybStatus: merchant.kybStatus,
    kybVerifiedAt: merchant.kybVerifiedAt?.toISOString() ?? null,
    kybSubmittedAt: merchant.kybSubmittedAt?.toISOString() ?? null,
    kybReviewNote: merchant.kybReviewNote,
    settlementTermsAcceptedAt:
      merchant.settlementTermsAcceptedAt?.toISOString() ?? null,
    flatFeeBps: merchant.flatFeeBps,
    fxSpreadBps: merchant.fxSpreadBps,
    profileVersion: merchant.profileVersion,
    businessProfile: merchant.businessProfile,
    createdAt: merchant.createdAt.toISOString(),
  };
}

/** A key's display-safe metadata. The secret and its hash never appear here. */
export function toApiKeyView(key: ApiKeyRow) {
  return {
    id: key.id,
    name: key.name,
    fingerprint: key.fingerprint,
    mode: key.mode,
    executionCluster: key.executionCluster,
    rotatedFromId: key.rotatedFromId,
    // When set, this key was rotated and stays valid only until this instant;
    // the portal shows it as expiring rather than plainly active.
    rotationGraceUntil: key.rotationGraceUntil?.toISOString() ?? null,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
  };
}

/** A webhook endpoint's owner view. Signing secrets never appear on a read. */
export function toWebhookEndpointView(endpoint: EndpointRow) {
  return {
    id: endpoint.id,
    url: endpoint.url,
    mode: endpoint.mode,
    enabled: endpoint.enabled,
    eventTypes: endpoint.eventTypes,
    secondaryExpiresAt: endpoint.secondaryExpiresAt?.toISOString() ?? null,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
  };
}
