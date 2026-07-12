import { z } from "zod";

import { handleError, ErrorCode } from "@/utils/errors";
import { AuthStorage } from "@/utils/storage/authStorage";

/**
 * /auth/exchange request + response. Mirrors `ExchangeRequestSchema` and
 * `ExchangeResponseSchema` in `apps/backend/src/auth/dtos.ts`. Kept in sync
 * by hand; the backend types are not published as a workspace package today.
 */
export const ExchangeRequestSchema = z.object({
  privyIdToken: z.string().min(1),
});
export type ExchangeRequest = z.infer<typeof ExchangeRequestSchema>;

export const ExchangeResponseSchema = z.object({
  token: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    walletAddress: z.string(),
    isNewUser: z.boolean(),
  }),
});
export type ExchangeResponse = z.infer<typeof ExchangeResponseSchema>;

// Mirrors `MirrorPasskeyCredentialSchema` in apps/backend/src/auth/dtos.ts.
export const MirrorPasskeyCredentialRequestSchema = z.object({
  credentialId: z.string().min(1).max(1024),
  publicKey: z.string().min(1).max(4096).optional(),
});
export type MirrorPasskeyCredentialRequest = z.infer<
  typeof MirrorPasskeyCredentialRequestSchema
>;

export const MirrorPasskeyCredentialResponseSchema = z.object({
  mirrored: z.boolean(),
});
export type MirrorPasskeyCredentialResponse = z.infer<
  typeof MirrorPasskeyCredentialResponseSchema
>;

// Mirrors apps/backend/src/wallets/dtos.ts.
export const WalletResponseSchema = z.object({
  walletAddress: z.string(),
  provider: z.literal("privy"),
});
export type WalletResponse = z.infer<typeof WalletResponseSchema>;

export const TokenBalanceSchema = z.object({
  mint: z.string(),
  amountRaw: z.string(),
  decimals: z.number().int(),
  symbol: z.string().nullable(),
});
export type TokenBalance = z.infer<typeof TokenBalanceSchema>;

export const BalancesResponseSchema = z.object({
  walletAddress: z.string(),
  tokens: z.array(TokenBalanceSchema),
  fetchedAtSlot: z.number().int(),
});
export type BalancesResponse = z.infer<typeof BalancesResponseSchema>;

// Mirrors apps/backend/src/transfer/dtos.ts.
export const PrepareTransferRequestSchema = z.object({
  toAddress: z.string(),
  mint: z.string(),
  amountRaw: z.string().regex(/^\d+$/),
  memo: z.string().max(120).optional(),
});
export type PrepareTransferRequest = z.infer<
  typeof PrepareTransferRequestSchema
>;

export const PrepareTransferResponseSchema = z.object({
  intentId: z.string(),
  unsignedTxBase64: z.string(),
  feeLamports: z.number().int().nonnegative(),
  expiresAt: z.string().datetime(),
});
export type PrepareTransferResponse = z.infer<
  typeof PrepareTransferResponseSchema
>;

export const SubmitTransferRequestSchema = z.object({
  intentId: z.string(),
  signedTxBase64: z.string(),
});
export type SubmitTransferRequest = z.infer<typeof SubmitTransferRequestSchema>;

export const SubmitTransferResponseSchema = z.object({
  transferId: z.string(),
  signature: z.string(),
  status: z.literal("PENDING"),
});
export type SubmitTransferResponse = z.infer<
  typeof SubmitTransferResponseSchema
>;

export const TransferRowSchema = z.object({
  id: z.string(),
  direction: z.enum(["SEND", "RECEIVE"]),
  mint: z.string(),
  amountRaw: z.string(),
  fromAddress: z.string(),
  toAddress: z.string(),
  status: z.enum(["PENDING", "CONFIRMED", "FAILED"]),
  signature: z.string().nullable(),
  memo: z.string().nullable(),
  createdAt: z.string().datetime(),
  confirmedAt: z.string().datetime().nullable(),
});
export type TransferRow = z.infer<typeof TransferRowSchema>;

/**
 * Backend returns `{ transfers: [...], nextCursor: ... }`
 * (apps/backend/src/transfer/dtos.ts → ListTransfersResponseSchema).
 * The mobile field name is preserved from the backend; do not re-key on
 * the client.
 */
export const TransferListResponseSchema = z.object({
  transfers: z.array(TransferRowSchema),
  nextCursor: z.string().nullable(),
});
export type TransferListResponse = z.infer<typeof TransferListResponseSchema>;

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: any
  ) {
    super(message);
    this.name = "ApiError";
  }
}

class BackendClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;

  constructor() {
    this.validateEnv();
    this.baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL!;
    this.defaultHeaders = {
      "Content-Type": "application/json",
    };
  }

  private validateEnv() {
    if (!process.env.EXPO_PUBLIC_BACKEND_URL) {
      throw new Error(
        "Missing required environment variable: EXPO_PUBLIC_BACKEND_URL"
      );
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit & { auth?: boolean } = {}
  ): Promise<T> {
    try {
      const url = `${this.baseUrl}${endpoint}`;

      // Attach the Bearer JWT from AuthStorage only when `auth: true` is set.
      const authHeaders: Record<string, string> = {};
      if (options.auth) {
        const token = await AuthStorage.getToken();
        if (token) {
          authHeaders["Authorization"] = `Bearer ${token}`;
        }
      }

      const fetchOptions: RequestInit = {
        ...options,
        headers: {
          ...this.defaultHeaders,
          ...authHeaders,
          ...options.headers,
        },
      };
      // Remove our internal flag before fetch sees it.
      delete (fetchOptions as { auth?: boolean }).auth;

      if (options.method === "GET") {
        delete fetchOptions.body;
      }

      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => console.error("Error parsing response:", response));

        // 401 on an authed endpoint → token is invalid or expired. Clear the
        // local JWT so the next app start re-exchanges against the Privy
        // session (which may have auto-refreshed). Do NOT force-logout here:
        // it would break the confirm flow, and screens decide their own UX
        // response (toast / retry / redirect).
        if (response.status === 401 && options.auth) {
          await AuthStorage.saveToken("").catch(() => {});
        }

        if (errorData?.details?.[0]?.code) {
          const code = errorData.details[0].code as ErrorCode;
          const errorCodesToDisplay = [ErrorCode.OTP_RATE_LIMIT];

          if (errorCodesToDisplay.includes(code as ErrorCode)) {
            handleError(code, true, true);
          } else {
            handleError(code, true, false);
          }
        }

        throw new ApiError(
          "BackendClient: Request failed",
          response.status,
          errorData
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error("BackendClient: Unexpected error in request():", error);
      handleError(ErrorCode.UNKNOWN_ERROR, true, false);
      throw error;
    }
  }

  /**
   * Exchange a Privy ID token for our backend JWT.
   *
   * Calls `POST /auth/exchange` on the NestJS backend; the backend verifies
   * the token against Privy's JWKS, upserts the `users` + `smart_accounts`
   * row, and returns `{ token, user: { id, email, walletAddress, isNewUser } }`.
   *
   * The caller is `AuthContext`; the returned JWT is
   * persisted via `AuthStorage.saveToken` and used as the Bearer on every
   * subsequent NestJS request.
   *
   * Response is validated with `ExchangeResponseSchema` so any backend drift
   * fails loudly at the network boundary rather than silently in screens.
   */
  async exchange(req: ExchangeRequest): Promise<ExchangeResponse> {
    const raw = await this.request<unknown>("/auth/exchange", {
      method: "POST",
      body: JSON.stringify(ExchangeRequestSchema.parse(req)),
    });
    return ExchangeResponseSchema.parse(raw);
  }

  /** POST /auth/passkey-credentials — mirror a freshly enrolled passkey
   *  credential (credentialId + optional publicKey) for the authenticated
   *  Consumer. Called fire-and-forget from the enrollment hook; a failure
   *  must never block or surface in enrollment. */
  async mirrorPasskeyCredential(
    req: MirrorPasskeyCredentialRequest
  ): Promise<MirrorPasskeyCredentialResponse> {
    const raw = await this.request<unknown>("/auth/passkey-credentials", {
      method: "POST",
      body: JSON.stringify(MirrorPasskeyCredentialRequestSchema.parse(req)),
      auth: true,
    });
    return MirrorPasskeyCredentialResponseSchema.parse(raw);
  }

  /** GET /wallet/me — returns the authenticated user's Privy embedded
   *  Solana wallet address. */
  async getWallet(): Promise<WalletResponse> {
    const raw = await this.request<unknown>("/wallet/me", {
      method: "GET",
      auth: true,
    });
    return WalletResponseSchema.parse(raw);
  }

  /** GET /wallet/me/balances — returns the full SPL token balance list. The
   *  client filters for headline currencies (USDC + USDT); the full list is
   *  preserved so a future Investments screen can list every mint. */
  async getBalances(): Promise<BalancesResponse> {
    const raw = await this.request<unknown>("/wallet/me/balances", {
      method: "GET",
      auth: true,
    });
    return BalancesResponseSchema.parse(raw);
  }

  /** POST /transfers/prepare — backend builds an unsigned v0 transaction
   *  and returns its base64 form alongside an `intentId`. The mobile app
   *  signs with the Privy embedded wallet and calls `submitTransfer`. */
  async prepareTransfer(
    req: PrepareTransferRequest
  ): Promise<PrepareTransferResponse> {
    const raw = await this.request<unknown>("/transfers/prepare", {
      method: "POST",
      body: JSON.stringify(PrepareTransferRequestSchema.parse(req)),
      auth: true,
    });
    return PrepareTransferResponseSchema.parse(raw);
  }

  /** POST /transfers/submit — backend forwards the signed transaction to
   *  the Solana RPC and creates a transfers row in PENDING. The RPC
   *  tailer transitions it to CONFIRMED / FAILED asynchronously. */
  async submitTransfer(
    req: SubmitTransferRequest
  ): Promise<SubmitTransferResponse> {
    const raw = await this.request<unknown>("/transfers/submit", {
      method: "POST",
      body: JSON.stringify(SubmitTransferRequestSchema.parse(req)),
      auth: true,
    });
    return SubmitTransferResponseSchema.parse(raw);
  }

  /** GET /transfers — cursor-paginated list of the authenticated user's
   *  transfers (SEND + RECEIVE union). Used by the Activity feed. */
  async listTransfers(req?: {
    cursor?: string;
    limit?: number;
  }): Promise<TransferListResponse> {
    const search = new URLSearchParams();
    if (req?.cursor) search.set("cursor", req.cursor);
    if (req?.limit != null) search.set("limit", String(req.limit));
    const qs = search.toString();
    const raw = await this.request<unknown>(`/transfers${qs ? `?${qs}` : ""}`, {
      method: "GET",
      auth: true,
    });
    return TransferListResponseSchema.parse(raw);
  }
}

export const apiClient = new BackendClient();
