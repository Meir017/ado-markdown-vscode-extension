import * as assert from 'assert';

import {
  buildFallbackHref,
  resolveActiveContext,
} from '../extension/activeContext';

describe('resolveActiveContext', () => {
  const enabled = (over: Partial<Parameters<typeof resolveActiveContext>[0]> = {}) => ({
    enabled: true,
    organization: '',
    project: '',
    ...over,
  });

  it('stays inactive when the extension is disabled', () => {
    const ctx = resolveActiveContext(enabled({ enabled: false, organization: 'orgX' }), [
      { organization: 'detected', project: 'p' },
    ]);
    assert.strictEqual(ctx.enabled, false);
    assert.strictEqual(ctx.source, 'none');
  });

  it('uses an explicit organization even with no detected ADO repo (non-ADO workspace)', () => {
    const ctx = resolveActiveContext(enabled({ organization: 'fabrikam' }), []);
    assert.deepStrictEqual(ctx, {
      enabled: true,
      organization: 'fabrikam',
      project: '',
      source: 'config',
    });
  });

  it('explicit org takes precedence over a different detected org', () => {
    const ctx = resolveActiveContext(enabled({ organization: 'override-org' }), [
      { organization: 'detected-org', project: 'detected-proj' },
    ]);
    assert.strictEqual(ctx.organization, 'override-org');
    assert.strictEqual(ctx.source, 'config');
    // Detected project belongs to a *different* org — must NOT leak into the
    // overridden context (would silently mix orgs).
    assert.strictEqual(ctx.project, '');
  });

  it('uses the detected project when explicit org matches the detected org', () => {
    const ctx = resolveActiveContext(enabled({ organization: 'Microsoft' }), [
      { organization: 'microsoft', project: 'OS' },
    ]);
    assert.strictEqual(ctx.organization, 'Microsoft');
    assert.strictEqual(ctx.project, 'OS');
    assert.strictEqual(ctx.source, 'config');
  });

  it('explicit project always wins over the detected project', () => {
    const ctx = resolveActiveContext(
      enabled({ organization: 'microsoft', project: 'CustomProj' }),
      [{ organization: 'microsoft', project: 'OS' }],
    );
    assert.strictEqual(ctx.project, 'CustomProj');
  });

  it('falls back to the first detected ADO context when no override is set', () => {
    const ctx = resolveActiveContext(enabled(), [
      { organization: 'detected-org', project: 'detected-proj' },
      { organization: 'second-org', project: 'second-proj' },
    ]);
    assert.deepStrictEqual(ctx, {
      enabled: true,
      organization: 'detected-org',
      project: 'detected-proj',
      source: 'detected',
    });
  });

  it('stays inactive when neither config nor detection yield an org', () => {
    const ctx = resolveActiveContext(enabled(), []);
    assert.strictEqual(ctx.enabled, false);
    assert.strictEqual(ctx.source, 'none');
  });

  it('trims surrounding whitespace from the explicit organization', () => {
    const ctx = resolveActiveContext(enabled({ organization: '  fabrikam  ' }), []);
    assert.strictEqual(ctx.organization, 'fabrikam');
  });
});

describe('buildFallbackHref', () => {
  it('builds a project-scoped work-item edit URL when both org and project are known', () => {
    const href = buildFallbackHref(
      { kind: 'workItem', id: 42 },
      { organization: 'microsoft', project: 'OS' },
    );
    assert.strictEqual(href, 'https://dev.azure.com/microsoft/OS/_workitems/edit/42');
  });

  it('builds an org-scoped work-item edit URL when project is unknown', () => {
    const href = buildFallbackHref(
      { kind: 'workItem', id: 42 },
      { organization: 'fabrikam', project: '' },
    );
    // The org-scoped path resolves correctly without a project segment.
    assert.strictEqual(href, 'https://dev.azure.com/fabrikam/_workitems/edit/42');
  });

  it('builds a project-scoped pull request URL when both org and project are known', () => {
    const href = buildFallbackHref(
      { kind: 'pullRequest', id: 99 },
      { organization: 'microsoft', project: 'OS' },
    );
    assert.strictEqual(
      href,
      'https://dev.azure.com/microsoft/OS/_git/_pullrequest/99',
    );
  });

  it('routes to the org pull-request hub when project is unknown', () => {
    const href = buildFallbackHref(
      { kind: 'pullRequest', id: 99 },
      { organization: 'fabrikam', project: '' },
    );
    // PR web URLs require a project segment, so we send the user to the
    // org-wide hub rather than producing a 404.
    assert.match(href, /^https:\/\/dev\.azure\.com\/fabrikam\/_pulls/);
  });

  it('percent-encodes special characters in org and project names', () => {
    const href = buildFallbackHref(
      { kind: 'workItem', id: 1 },
      { organization: 'My Org', project: 'My Proj' },
    );
    assert.match(href, /\/My%20Org\/My%20Proj\//);
  });
});
