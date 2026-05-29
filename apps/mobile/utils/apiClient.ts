import { handleError, ErrorCode } from "@/utils/errors";
import {
  SessionSecrets,
  GetPasskeysResponse,
  CreatePasskeySessionResponse,
  MetaInfo,
} from "@sqds/grid-react-native";
import { AuthStorage } from "@/utils/storage/authStorage";
import { AuthEvents } from "@/utils/authEvents";
import type {
  WalletDto,
  BalancesDto,
  TransactionsDto,
  TransactionRowDto,
  SendTransactionDto,
} from "@/types/Backend";

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

// Endpoints that must NOT carry an Authorization header — they're how the user
// obtains the token in the first place. Anything else gets `Bearer <jwt>` if a
// token is in SecureStore.
const PUBLIC_PATHS = new Set<string>([
  "/register",
  "/auth",
  "/verify-otp",
  "/verify-otp-and-create-account",
  "/passkeys/check",
  "/passkeys/session",
]);

class BackendClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;

  constructor() {
    this.validateEnv();
    this.baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL!.replace(/\/$/, "");
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
    endpoint: `/${string}`,
    options: RequestInit = {}
  ): Promise<T> {
    try {
      const url = `${this.baseUrl}${endpoint}`;

      // Attach Authorization: Bearer for protected endpoints when a token exists.
      // PUBLIC_PATHS (auth bootstrap) get no header. The AuthEvents emitter
      // breaks the apiClient ↔ AuthContext cycle on 401.
      const authHeader: Record<string, string> = {};
      if (!PUBLIC_PATHS.has(endpoint)) {
        const token = await AuthStorage.getToken();
        if (token) {
          authHeader.Authorization = `Bearer ${token}`;
        }
      }

      const fetchOptions: RequestInit = {
        ...options,
        headers: {
          ...this.defaultHeaders,
          ...authHeader,
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

        // 401 → notify AuthContext (via the event bus) so it can log the user
        // out and route to /(auth)/login. Public bootstrap endpoints can still
        // legitimately return 401 (wrong OTP etc.); only emit for protected
        // paths where 401 means "session is dead".
        if (response.status === 401 && !PUBLIC_PATHS.has(endpoint)) {
          AuthEvents.emitUnauthorized();
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

  // ── Wallet + transactions (wire-real-backend Phase 4) ────────────────────
  // All four are JWT-guarded on the backend; request<T>() above attaches the
  // Bearer header. Decimal amount is mobile-side (Clarify #2); backend converts
  // to base units before calling Grid.

  async getWallet(): Promise<WalletDto> {
    return this.request<WalletDto>("/wallets/me", { method: "GET" });
  }

  async getBalances(): Promise<BalancesDto> {
    return this.request<BalancesDto>("/wallets/me/balances", { method: "GET" });
  }

  async getTransactions(): Promise<TransactionsDto> {
    return this.request<TransactionsDto>("/transactions", { method: "GET" });
  }

  async sendTransaction(dto: SendTransactionDto): Promise<TransactionRowDto> {
    return this.request<TransactionRowDto>("/transactions/send", {
      method: "POST",
      body: JSON.stringify(dto),
    });
  }
}

export const apiClient = new BackendClient();
