import * as assert from 'assert';
import type { AccessToken } from '@azure/identity';

import {
  ADO_SCOPE,
  AZ_CLI_INSTALL_URL,
  AzCliAuthError,
  AzureCliTokenProvider,
  CredentialLike,
} from '../ado/tokenProvider';

function fakeToken(expiresInMs: number, value = 'jwt'): AccessToken {
  return { token: value, expiresOnTimestamp: Date.now() + expiresInMs };
}

describe('AzureCliTokenProvider', () => {
  it('requests the ADO scope and returns a Bearer header', async () => {
    let receivedScope: string | string[] | undefined;
    const credential: CredentialLike = {
      async getToken(scopes) {
        receivedScope = scopes;
        return fakeToken(60 * 60 * 1000, 'jwt-A');
      },
    };
    const provider = new AzureCliTokenProvider({ credential });
    const header = await provider.getAuthHeader();
    assert.strictEqual(receivedScope, ADO_SCOPE);
    assert.strictEqual(header, 'Bearer jwt-A');
  });

  it('caches the token across calls within the validity window', async () => {
    let calls = 0;
    const credential: CredentialLike = {
      async getToken() {
        calls += 1;
        return fakeToken(60 * 60 * 1000, `jwt-${calls}`);
      },
    };
    const provider = new AzureCliTokenProvider({ credential });
    const a = await provider.getAuthHeader();
    const b = await provider.getAuthHeader();
    const c = await provider.getAuthHeader();
    assert.strictEqual(a, 'Bearer jwt-1');
    assert.strictEqual(b, 'Bearer jwt-1');
    assert.strictEqual(c, 'Bearer jwt-1');
    assert.strictEqual(calls, 1);
  });

  it('refreshes the token when within the skew window of expiry', async () => {
    let calls = 0;
    const credential: CredentialLike = {
      async getToken() {
        calls += 1;
        // First call returns a token expiring in 60s; second call returns a fresh long-lived one.
        return calls === 1
          ? fakeToken(60 * 1000, 'jwt-near-expiry')
          : fakeToken(60 * 60 * 1000, 'jwt-fresh');
      },
    };
    const provider = new AzureCliTokenProvider({ credential, refreshSkewMs: 5 * 60 * 1000 });
    const first = await provider.getAuthHeader();
    const second = await provider.getAuthHeader();
    assert.strictEqual(first, 'Bearer jwt-near-expiry');
    // Within the 5-min skew → must refresh.
    assert.strictEqual(second, 'Bearer jwt-fresh');
    assert.strictEqual(calls, 2);
  });

  it('coalesces concurrent token fetches into a single underlying call', async () => {
    let calls = 0;
    let resolveCredential: ((t: AccessToken) => void) | undefined;
    const credential: CredentialLike = {
      getToken() {
        calls += 1;
        return new Promise<AccessToken>((resolve) => {
          resolveCredential = resolve;
        });
      },
    };
    const provider = new AzureCliTokenProvider({ credential });
    const p1 = provider.getAuthHeader();
    const p2 = provider.getAuthHeader();
    const p3 = provider.getAuthHeader();
    assert.ok(resolveCredential, 'getToken should have been invoked');
    resolveCredential!(fakeToken(60 * 60 * 1000, 'jwt-shared'));
    const [h1, h2, h3] = await Promise.all([p1, p2, p3]);
    assert.strictEqual(h1, 'Bearer jwt-shared');
    assert.strictEqual(h2, 'Bearer jwt-shared');
    assert.strictEqual(h3, 'Bearer jwt-shared');
    assert.strictEqual(calls, 1);
  });

  it('maps credential exceptions to AzCliAuthError with aka.ms/azcli guidance', async () => {
    const credential: CredentialLike = {
      async getToken() {
        const err = new Error('CredentialUnavailable: az not on PATH');
        err.name = 'CredentialUnavailableError';
        throw err;
      },
    };
    const provider = new AzureCliTokenProvider({ credential });
    await assert.rejects(
      () => provider.getAuthHeader(),
      (err: unknown) => {
        assert.ok(err instanceof AzCliAuthError);
        assert.match((err as AzCliAuthError).userMessage, /aka\.ms\/azcli/);
        assert.match((err as AzCliAuthError).userMessage, /az login/);
        // The pointed-to install URL should be present verbatim.
        assert.ok((err as AzCliAuthError).userMessage.includes(AZ_CLI_INSTALL_URL));
        return true;
      },
    );
  });

  it('treats a null token as an auth error', async () => {
    const credential: CredentialLike = {
      async getToken() { return null; },
    };
    const provider = new AzureCliTokenProvider({ credential });
    await assert.rejects(() => provider.getAuthHeader(), AzCliAuthError);
  });
});
