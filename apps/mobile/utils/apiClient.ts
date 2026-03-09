import { handleError, ErrorCode } from "@/utils/errors";
import { SessionSecrets } from "@sqds/grid-react-native";

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
}

export const apiClient = new BackendClient();
