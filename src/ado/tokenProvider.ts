/**
 * Token provider abstraction for Azure DevOps REST calls.
 *
 * The default implementation wraps `@azure/identity`'s `AzureCliCredential`
 * so the extension transparently picks up the user's existing `az login`
 * session. The credential is injectable for unit tests.
 *
 * On any failure (Azure CLI missing / not logged in / consent error) we
 * normalise the exception into `AzCliAuthError` carrying a user-facing
 * guidance string that points at https://aka.ms/azcli — the markdown
 * preview surfaces this verbatim as the link tooltip.
 */
import { AzureCliCredential } from '@azure/identity';
import type { AccessToken } from '@azure/identity';

/** Well-known Azure DevOps resource id (Microsoft tenant). */
export const ADO_RESOURCE_ID = '499b84ac-1321-427f-aa17-267ca6975798';
/** Scope used with `getToken`. The `.default` form means "all consented scopes". */
export const ADO_SCOPE = `${ADO_RESOURCE_ID}/.default`;

export const AZ_CLI_INSTALL_URL = 'https://aka.ms/azcli';
export const AZ_CLI_GUIDANCE =
  `Azure CLI not available — install from ${AZ_CLI_INSTALL_URL} and run 'az login'.`;

/**
 * Thrown by the token provider when no token can be obtained. The
 * `userMessage` is safe to surface in the markdown preview tooltip.
 */
export class AzCliAuthError extends Error {
  readonly userMessage: string;

  constructor(userMessage: string, cause?: unknown) {
    super(userMessage);
    this.name = 'AzCliAuthError';
    this.userMessage = userMessage;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

export interface TokenProvider {
  /** Returns a fully-formed `Authorization` header value (e.g. `Bearer ...`). */
  getAuthHeader(): Promise<string>;
}

/**
 * Minimal shape of `@azure/identity`'s `TokenCredential` we depend on,
 * exposed so tests can inject a fake without pulling in the credential
 * SDK.
 */
export interface CredentialLike {
  getToken(scopes: string | string[]): Promise<AccessToken | null>;
}

export interface AzureCliTokenProviderOptions {
  credential?: CredentialLike;
  /** Refresh window (ms) before token expiry. Default 5 min. */
  refreshSkewMs?: number;
  now?: () => number;
}

export class AzureCliTokenProvider implements TokenProvider {
  private readonly credential: CredentialLike;
  private readonly refreshSkewMs: number;
  private readonly now: () => number;
  private cached: AccessToken | undefined;
  private inFlight: Promise<AccessToken> | undefined;

  constructor(options: AzureCliTokenProviderOptions = {}) {
    this.credential = options.credential ?? new AzureCliCredential();
    this.refreshSkewMs = options.refreshSkewMs ?? 5 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  async getAuthHeader(): Promise<string> {
    const token = await this.getToken();
    return `Bearer ${token.token}`;
  }

  /** Exposed for tests. */
  async getToken(): Promise<AccessToken> {
    if (this.cached && this.cached.expiresOnTimestamp - this.now() > this.refreshSkewMs) {
      return this.cached;
    }
    if (this.inFlight) {
      return this.inFlight;
    }
    this.inFlight = this.fetchToken();
    try {
      this.cached = await this.inFlight;
      return this.cached;
    } finally {
      this.inFlight = undefined;
    }
  }

  private async fetchToken(): Promise<AccessToken> {
    let token: AccessToken | null;
    try {
      token = await this.credential.getToken(ADO_SCOPE);
    } catch (err) {
      throw new AzCliAuthError(AZ_CLI_GUIDANCE, err);
    }
    if (!token) {
      throw new AzCliAuthError(AZ_CLI_GUIDANCE);
    }
    return token;
  }
}
