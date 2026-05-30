import { z } from "zod";

import { handleError, ErrorCode } from "@/utils/errors";
import {
  SessionSecrets,
  GetPasskeysResponse,
  CreatePasskeySessionResponse,
  MetaInfo,
} from "@sqds/grid-react-native";

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
    options: RequestInit = {}
  ): Promise<T> {
    try {
      const url = `${this.baseUrl}${endpoint}`;

      const fetchOptions: RequestInit = {
        ...options,
        headers: {
          ...this.defaultHeaders,
          ...options.headers,
        },
      };

      if (options.method === "GET") {
        delete fetchOptions.body;
      }

      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => console.error("Error parsing response:", response));

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

  async authenticate(email: string) {
    return this.request<any>("/auth", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  async register(email: string) {
    return this.request<any>("/register", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  async verifyOtp(request: {
    otpCode: string;
    sessionSecrets: SessionSecrets;
    user: any;
  }) {
    return this.request<any>("/verify-otp", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async verifyOtpAndCreateAccount(request: {
    otpCode: string;
    sessionSecrets: SessionSecrets;
    user: any;
  }) {
    return this.request<any>("/verify-otp-and-create-account", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }
  async checkPasskeys(accountAddress: string) {
    return this.request<GetPasskeysResponse>("/passkeys/check", {
      method: "POST",
      body: JSON.stringify({ accountAddress }),
    });
  }

  async createPasskeySession(accountAddress: string, metaInfo: MetaInfo) {
    return this.request<CreatePasskeySessionResponse>("/passkeys/session", {
      method: "POST",
      body: JSON.stringify({ accountAddress, metaInfo }),
    });
  }

  /**
   * Exchange a Privy ID token for our backend JWT (Phase 4 new-stack path).
   *
   * Calls `POST /auth/exchange` on the NestJS backend; the backend verifies
   * the token against Privy's JWKS, upserts the `users` + `smart_accounts`
   * row, and returns `{ token, user: { id, email, walletAddress, isNewUser } }`.
   *
   * The caller is `AuthContext` under `useNewStack()`; the returned JWT is
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
}

export const apiClient = new BackendClient();
