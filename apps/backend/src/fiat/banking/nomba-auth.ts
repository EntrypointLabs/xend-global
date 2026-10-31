import { NombaError, type NombaTransport } from './nomba.adapter';

export interface NombaSandboxCredentials {
  clientId: string;
  clientSecret: string;
  accountId: string;
}
interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/** Server-only OAuth cache. No credentials, provider bodies or tokens enter errors.
 * https://developer.nomba.com/docs/getting-started/authentication
 * https://developer.nomba.com/docs/products/accept-payment/sandbox-testing
 * Authentication is not evidence of money settlement in Nomba's sandbox.
 */
export class NombaSandboxAuth {
  private token?: TokenSet;
  private pending?: Promise<string>;

  constructor(
    private readonly credentials: NombaSandboxCredentials,
    private readonly transport: NombaTransport = fetch,
    private readonly now: () => number = Date.now,
  ) {
    if (
      [
        credentials.clientId,
        credentials.clientSecret,
        credentials.accountId,
      ].some(
        (value) =>
          typeof value !== 'string' || !value.trim() || /\s/.test(value),
      )
    )
      throw new NombaError('NOMBA_INCOMPLETE_AUTH');
  }

  getAccessToken(): Promise<string> {
    if (this.pending) return this.pending;
    if (this.token && this.token.expiresAt - this.now() > 300_000)
      return Promise.resolve(this.token.accessToken);
    this.pending = this.exchange().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  /** A late 401 for an old token must not discard a newer token. */
  invalidate(accessToken: string): void {
    if (this.token?.accessToken === accessToken) this.token = undefined;
  }

  private async exchange(): Promise<string> {
    const previous = this.token;
    let response: Response;
    try {
      response = await this.transport(
        `https://sandbox.nomba.com/v1/auth/token/${previous ? 'refresh' : 'issue'}`,
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(15_000),
          headers: {
            'Content-Type': 'application/json',
            accountId: this.credentials.accountId,
            ...(previous
              ? { Authorization: `Bearer ${previous.accessToken}` }
              : {}),
          },
          body: JSON.stringify(
            previous
              ? {
                  grant_type: 'refresh_token',
                  refresh_token: previous.refreshToken,
                }
              : {
                  grant_type: 'client_credentials',
                  client_id: this.credentials.clientId,
                  client_secret: this.credentials.clientSecret,
                },
          ),
        },
      );
    } catch {
      throw new NombaError('NOMBA_AUTH_UNAVAILABLE');
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        this.token = undefined;
      throw new NombaError(
        response.status >= 500 || response.status === 429
          ? 'NOMBA_AUTH_UNAVAILABLE'
          : 'NOMBA_AUTH_REJECTED',
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new NombaError('NOMBA_AUTH_INVALID_RESPONSE');
    }
    if (!payload || typeof payload !== 'object')
      throw new NombaError('NOMBA_AUTH_INVALID_RESPONSE');
    const row = payload as Record<string, unknown>;
    if (row.code !== '00') {
      if (row.code === '401' || row.code === '403') this.token = undefined;
      throw new NombaError('NOMBA_AUTH_REJECTED');
    }
    const data = row.data as Record<string, unknown> | undefined;
    if (
      !data ||
      typeof data.access_token !== 'string' ||
      !data.access_token ||
      /\s/.test(data.access_token) ||
      typeof data.refresh_token !== 'string' ||
      !data.refresh_token ||
      /\s/.test(data.refresh_token) ||
      typeof data.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(data.expiresAt)) ||
      Date.parse(data.expiresAt) <= this.now() + 15_000
    )
      throw new NombaError('NOMBA_AUTH_INVALID_RESPONSE');
    this.token = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.parse(data.expiresAt),
    };
    return this.token.accessToken;
  }
}
