import * as assert from 'assert';

import { AdoClient, normalizeStatus } from '../ado/client';
import { AzCliAuthError, TokenProvider } from '../ado/tokenProvider';

function bearer(value = 'fake-jwt'): TokenProvider {
  return { async getAuthHeader() { return `Bearer ${value}`; } };
}

interface FakeResp {
  ok: boolean;
  status: number;
  statusText: string;
  body: string;
  contentType?: string;
}

function resp(body: unknown, init: Partial<FakeResp> = {}): FakeResp {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: init.ok ?? (init.status ? init.status < 400 : true),
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    contentType: init.contentType ?? 'application/json',
    body: text,
  };
}

function fakeFetch(maker: (url: string, headers?: Record<string, string>) => FakeResp) {
  return async (url: string, init?: { headers?: Record<string, string> }) => {
    const r = maker(url, init?.headers);
    return {
      ok: r.ok,
      status: r.status,
      statusText: r.statusText,
      headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? r.contentType ?? '' : null) },
      async text() { return r.body; },
    };
  };
}

describe('AdoClient', () => {
  it('normalizeStatus maps known values and falls back', () => {
    assert.strictEqual(normalizeStatus('active'), 'active');
    assert.strictEqual(normalizeStatus('Completed'), 'completed');
    assert.strictEqual(normalizeStatus('ABANDONED'), 'abandoned');
    assert.strictEqual(normalizeStatus(undefined), 'unknown');
    assert.strictEqual(normalizeStatus('weird'), 'unknown');
  });

  it('getWorkItem hits the org-scoped URL with a Bearer auth header', async () => {
    let capturedWiUrl = '';
    let capturedHeaders: Record<string, string> | undefined;
    const client = new AdoClient(
      { organization: 'myorg', project: 'myproj' },
      bearer('jwt-abc'),
      fakeFetch((url, headers) => {
        if (url.includes('/wit/workitems/')) {
          capturedWiUrl = url;
          capturedHeaders = headers;
          return resp({
            id: 42,
            fields: {
              'System.Title': 'Test WI',
              'System.State': 'Active',
              'System.WorkItemType': 'Bug',
            },
            _links: { html: { href: 'https://dev.azure.com/myorg/_workitems/edit/42' } },
          });
        }
        // Type-icon metadata fetch: gracefully fail so the icon falls back to undefined.
        return resp({}, { ok: false, status: 404, statusText: 'Not Found' });
      }),
    );
    const wi = await client.getWorkItem(42);
    assert.match(capturedWiUrl, /^https:\/\/dev\.azure\.com\/myorg\/_apis\/wit\/workitems\/42\?/);
    assert.match(capturedWiUrl, /System\.TeamProject/);
    assert.strictEqual(capturedHeaders?.Authorization, 'Bearer jwt-abc');
    // Auth is purely the bearer token — no TFS/MSA workaround headers.
    assert.strictEqual(capturedHeaders?.['X-TFS-FedAuthRedirect'], undefined);
    assert.deepStrictEqual(wi, {
      kind: 'workItem',
      id: 42,
      title: 'Test WI',
      state: 'Active',
      workItemType: 'Bug',
      url: 'https://dev.azure.com/myorg/_workitems/edit/42',
    });
  });

  it('getWorkItem inlines the work-item type icon as a base64 data URI', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle/></svg>';
    let typeUrl = '';
    let iconUrl = '';
    const client = new AdoClient(
      { organization: 'myorg', project: 'fallback' },
      bearer(),
      fakeFetch((url) => {
        if (url.includes('/wit/workitems/')) {
          return resp({
            id: 7,
            fields: {
              'System.Title': 'A bug',
              'System.State': 'Active',
              'System.WorkItemType': 'Bug',
              'System.TeamProject': 'OS',
            },
          });
        }
        if (url.includes('/wit/workitemtypes/')) {
          typeUrl = url;
          return resp({ color: 'FFCC293D', icon: { id: 'icon_insect' } });
        }
        if (url.includes('/wit/workItemIcons/')) {
          iconUrl = url;
          return resp(svg, { contentType: 'image/svg+xml' });
        }
        return resp({}, { ok: false, status: 404, statusText: 'Not Found' });
      }),
    );
    const wi = await client.getWorkItem(7);
    assert.match(typeUrl, /\/myorg\/OS\/_apis\/wit\/workitemtypes\/Bug\?/);
    // The leading alpha pair (FF) should be stripped before being passed as `color`.
    assert.match(iconUrl, /\/wit\/workItemIcons\/icon_insect\?.*color=CC293D/);
    assert.ok(wi.iconDataUri);
    assert.match(wi.iconDataUri!, /^data:image\/svg\+xml;base64,/);
    const decoded = Buffer.from(wi.iconDataUri!.split(',')[1], 'base64').toString('utf8');
    assert.strictEqual(decoded, svg);
  });

  it('getWorkItem falls back gracefully when icon metadata 404s', async () => {
    const client = new AdoClient(
      { organization: 'myorg', project: 'p' },
      bearer(),
      fakeFetch((url) => {
        if (url.includes('/wit/workitems/')) {
          return resp({
            id: 1,
            fields: {
              'System.Title': 'T',
              'System.State': 'Active',
              'System.WorkItemType': 'CustomType',
            },
          });
        }
        return resp({}, { ok: false, status: 404, statusText: 'Not Found' });
      }),
    );
    const wi = await client.getWorkItem(1);
    assert.strictEqual(wi.iconDataUri, undefined);
  });

  it('caches work-item type icons across calls', async () => {
    let typeFetches = 0;
    let iconFetches = 0;
    const client = new AdoClient(
      { organization: 'myorg', project: 'OS' },
      bearer(),
      fakeFetch((url) => {
        if (url.includes('/wit/workitems/')) {
          return resp({
            id: 1,
            fields: {
              'System.Title': 'T',
              'System.State': 'Active',
              'System.WorkItemType': 'Bug',
              'System.TeamProject': 'OS',
            },
          });
        }
        if (url.includes('/wit/workitemtypes/')) {
          typeFetches += 1;
          return resp({ color: 'CC293D', icon: { id: 'icon_insect' } });
        }
        if (url.includes('/wit/workItemIcons/')) {
          iconFetches += 1;
          return resp('<svg></svg>', { contentType: 'image/svg+xml' });
        }
        return resp({}, { ok: false, status: 404, statusText: 'Not Found' });
      }),
    );
    await client.getWorkItem(1);
    await client.getWorkItem(1);
    await client.getWorkItem(1);
    assert.strictEqual(typeFetches, 1, 'type metadata should be fetched at most once per (project,type)');
    assert.strictEqual(iconFetches, 1, 'icon SVG should be fetched at most once per (project,type)');
  });

  it('getPullRequest builds repository url', async () => {
    const client = new AdoClient(
      { organization: 'myorg', project: 'fallback' },
      bearer(),
      fakeFetch(() =>
        resp({
          pullRequestId: 11,
          title: 'Fix things',
          status: 'completed',
          isDraft: false,
          repository: { name: 'repo1', project: { name: 'realProj' } },
        }),
      ),
    );
    const pr = await client.getPullRequest(11);
    assert.strictEqual(pr.id, 11);
    assert.strictEqual(pr.status, 'completed');
    assert.strictEqual(pr.repository, 'repo1');
    assert.strictEqual(pr.url, 'https://dev.azure.com/myorg/realProj/_git/repo1/pullrequest/11');
  });

  it('throws on non-2xx (non-auth)', async () => {
    const client = new AdoClient(
      { organization: 'o', project: 'p' },
      bearer(),
      fakeFetch(() => resp({}, { ok: false, status: 404, statusText: 'Not Found' })),
    );
    await assert.rejects(() => client.getWorkItem(1), /404 Not Found/);
  });

  it('maps 401 to AzCliAuthError with az login guidance', async () => {
    const client = new AdoClient(
      { organization: 'myorg', project: 'p' },
      bearer(),
      fakeFetch(() => resp({}, { ok: false, status: 401, statusText: 'Unauthorized' })),
    );
    await assert.rejects(
      () => client.getWorkItem(1),
      (err: unknown) => {
        assert.ok(err instanceof AzCliAuthError, 'should be AzCliAuthError');
        assert.match((err as AzCliAuthError).userMessage, /az login/);
        assert.match((err as AzCliAuthError).userMessage, /myorg/);
        return true;
      },
    );
  });

  it('maps 403 to AzCliAuthError', async () => {
    const client = new AdoClient(
      { organization: 'o', project: 'p' },
      bearer(),
      fakeFetch(() => resp({}, { ok: false, status: 403, statusText: 'Forbidden' })),
    );
    await assert.rejects(() => client.getWorkItem(1), AzCliAuthError);
  });

  it('treats a 200 HTML sign-in page as an AzCliAuthError', async () => {
    const client = new AdoClient(
      { organization: 'myorg', project: 'p' },
      bearer(),
      fakeFetch(() =>
        resp('<!DOCTYPE html><html><head><title>Sign in</title></head></html>', {
          ok: true,
          status: 200,
          contentType: 'text/html; charset=utf-8',
        }),
      ),
    );
    await assert.rejects(
      () => client.getWorkItem(1),
      (err: unknown) => {
        assert.ok(err instanceof AzCliAuthError, 'should be AzCliAuthError');
        assert.match((err as AzCliAuthError).userMessage, /HTML page/);
        assert.match((err as AzCliAuthError).userMessage, /az login/);
        return true;
      },
    );
  });

  it('treats a 203 Non-Authoritative HTML body as an AzCliAuthError even with json content-type', async () => {
    const client = new AdoClient(
      { organization: 'myorg', project: 'p' },
      bearer(),
      fakeFetch(() =>
        resp('<html><body>Sign in</body></html>', {
          ok: true,
          status: 203,
          contentType: 'application/json',
        }),
      ),
    );
    await assert.rejects(() => client.getWorkItem(1), AzCliAuthError);
  });

  it('propagates AzCliAuthError thrown by the token provider', async () => {
    const failing: TokenProvider = {
      async getAuthHeader() {
        throw new AzCliAuthError('Azure CLI not available — install from https://aka.ms/azcli and run \'az login\'.');
      },
    };
    const client = new AdoClient(
      { organization: 'o', project: 'p' },
      failing,
      fakeFetch(() => {
        throw new Error('fetch should not be called when auth fails up-front');
      }),
    );
    await assert.rejects(
      () => client.getWorkItem(1),
      (err: unknown) => {
        assert.ok(err instanceof AzCliAuthError);
        assert.match((err as AzCliAuthError).userMessage, /aka\.ms\/azcli/);
        return true;
      },
    );
  });
});
