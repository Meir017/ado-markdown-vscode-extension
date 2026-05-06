import * as assert from 'assert';

import { AdoClient } from '../ado/client';
import { AzCliAuthError, TokenProvider } from '../ado/tokenProvider';
import { AdoResolver } from '../cache/resolver';

const okToken: TokenProvider = { async getAuthHeader() { return 'Bearer x'; } };

function makeClient(overrides: Partial<{ delay: number; fail: boolean; auth401: boolean }> = {}): AdoClient {
  return new AdoClient(
    { organization: 'o', project: 'p' },
    okToken,
    async () => {
      if (overrides.delay) {
        await new Promise((r) => setTimeout(r, overrides.delay));
      }
      if (overrides.auth401) {
        return {
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          headers: { get: () => null },
          async text() { return '{}'; },
        };
      }
      if (overrides.fail) {
        return {
          ok: false,
          status: 500,
          statusText: 'boom',
          headers: { get: () => null },
          async text() { return '{}'; },
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => 'application/json' },
        async text() {
          return JSON.stringify({
            id: 1,
            fields: { 'System.Title': 'T', 'System.State': 'Active', 'System.WorkItemType': 'Task' },
          });
        },
      };
    },
  );
}

function makeAuthFailingClient(): AdoClient {
  const failing: TokenProvider = {
    async getAuthHeader() {
      throw new AzCliAuthError(
        'Azure CLI not available — install from https://aka.ms/azcli and run \'az login\'.',
      );
    },
  };
  return new AdoClient({ organization: 'o', project: 'p' }, failing, async () => {
    throw new Error('fetch should not be called');
  });
}

function waitForUpdate(resolver: AdoResolver): Promise<void> {
  return new Promise((resolve) => {
    const dispose = resolver.onUpdate(() => {
      dispose();
      resolve();
    });
  });
}

describe('AdoResolver', () => {
  it('peek returns undefined initially; request schedules a fetch', async () => {
    const resolver = new AdoResolver(makeClient(), { ttlMs: 60_000 });
    const ref = { kind: 'workItem', id: 1 } as const;
    assert.strictEqual(resolver.peek(ref), undefined);
    assert.strictEqual(resolver.request(ref), true);
    assert.strictEqual(resolver.peek(ref)?.state, 'pending');
    await waitForUpdate(resolver);
    const entry = resolver.peek(ref);
    assert.strictEqual(entry?.state, 'resolved');
    if (entry?.state === 'resolved') {
      assert.strictEqual(entry.value.kind, 'workItem');
    }
  });

  it('coalesces repeated requests', () => {
    const resolver = new AdoResolver(makeClient({ delay: 50 }), { ttlMs: 60_000 });
    const ref = { kind: 'workItem', id: 1 } as const;
    assert.strictEqual(resolver.request(ref), true);
    assert.strictEqual(resolver.request(ref), false);
    assert.strictEqual(resolver.request(ref), false);
  });

  it('records errors as error entries', async () => {
    const resolver = new AdoResolver(makeClient({ fail: true }), { ttlMs: 60_000 });
    const ref = { kind: 'workItem', id: 2 } as const;
    resolver.request(ref);
    await waitForUpdate(resolver);
    const entry = resolver.peek(ref);
    assert.strictEqual(entry?.state, 'error');
  });

  it('expires resolved entries after ttl', async () => {
    const resolver = new AdoResolver(makeClient(), { ttlMs: 200 });
    const ref = { kind: 'workItem', id: 3 } as const;
    resolver.request(ref);
    await waitForUpdate(resolver);
    assert.strictEqual(resolver.peek(ref)?.state, 'resolved');
    await new Promise((r) => setTimeout(r, 250));
    assert.strictEqual(resolver.peek(ref), undefined);
  });

  it('surfaces AzCliAuthError guidance in the error entry', async () => {
    const resolver = new AdoResolver(makeAuthFailingClient(), { ttlMs: 60_000 });
    const ref = { kind: 'pullRequest', id: 9918141 } as const;
    resolver.request(ref);
    await waitForUpdate(resolver);
    const entry = resolver.peek(ref);
    assert.strictEqual(entry?.state, 'error');
    if (entry?.state === 'error') {
      assert.match(entry.error, /aka\.ms\/azcli/);
      assert.match(entry.error, /az login/);
    }
  });

  it('records 401 from ADO as an actionable auth error', async () => {
    const resolver = new AdoResolver(makeClient({ auth401: true }), { ttlMs: 60_000 });
    const ref = { kind: 'workItem', id: 5 } as const;
    resolver.request(ref);
    await waitForUpdate(resolver);
    const entry = resolver.peek(ref);
    assert.strictEqual(entry?.state, 'error');
    if (entry?.state === 'error') {
      assert.match(entry.error, /az login/);
    }
  });
});
