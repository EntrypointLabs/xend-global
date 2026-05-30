import { handleError, ErrorCode } from "@/utils/errors";
import { KycResponse, KycParams } from "@/types/Kyc";

/**
 * EasClient — slimmed in Phase 5 to ONLY the two KYC methods (`getKYCLink`,
 * `getKYCStatus`) the KYC carve-out depends on.
 *
 * The Sumsub KYC migration is a separate swarm scheduled LAST; until then,
 * KYC keeps working through `apps/mobile/app/api/kyc+api.ts` and
 * `apps/mobile/app/api/kyc-status+api.ts`, which delegate to the Grid
 * `@sqds/grid-react-native` SDK via `apps/mobile/grid/sdkClient.ts`.
 *
 * All other methods (authenticate, register, verifyOtpCode,
 * verifyCodeAndCreateAccount, createSmartAccount, getBalance,
 * preparePaymentIntent, confirmPaymentIntent, getVirtualAccounts,
 * openVirtualAccount, getTransfers, getSentryConfig) were deleted along
 * with their backing BFF routes.
 */

class EasError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: any
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class EasClient {
  private defaultHeaders: Record<string, string>;

  constructor() {
    this.defaultHeaders = {
      "Content-Type": "application/json",
    };
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    try {
      // KYC BFF routes are co-resident with the Expo app via expo-router
      // (apps/mobile/app/api/kyc+api.ts, kyc-status+api.ts). Use a relative
      // URL prefixed with `/api` to hit them; no host base URL needed.
      const url = `/api${endpoint}`;

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
        throw new EasError(
          "EasClient: Request failed",
          response.status,
          errorData
        );
      }

      return await response.json();
    } catch (error) {
      console.error("EasClient: Unexpected error in request():", error);
      handleError(ErrorCode.UNKNOWN_ERROR, true, false);
      throw error;
    }
  }

  async getKYCLink(request: KycParams): Promise<KycResponse> {
    return this.request<KycResponse>("/kyc", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async getKYCStatus(smartAccountAddress: string, kycId: string): Promise<any> {
    return this.request<any>(`/kyc-status`, {
      method: "POST",
      body: JSON.stringify({
        smart_account_address: smartAccountAddress,
        kyc_id: kycId,
      }),
    });
  }
}
