import * as assert from 'assert';
import MarkdownIt from 'markdown-it';

import { AdoRef } from '../ado/types';
import { CacheEntry } from '../cache/resolver';
import { adoRefPlugin, RefResolverPort, renderRef } from '../markdownIt/plugin';

class FakeResolver implements RefResolverPort {
  public requested: AdoRef[] = [];
  private readonly entries: Map<string, CacheEntry>;
  constructor(entries?: Map<string, CacheEntry>) {
    this.entries = entries ?? new Map<string, CacheEntry>();
  }
  set(ref: AdoRef, entry: CacheEntry): void {
    this.entries.set(`${ref.kind}:${ref.id}`, entry);
  }
  peek(ref: AdoRef): CacheEntry | undefined {
    return this.entries.get(`${ref.kind}:${ref.id}`);
  }
  request(ref: AdoRef): boolean {
    this.requested.push(ref);
    return true;
  }
}

function build(resolver: RefResolverPort, enabled = true): MarkdownIt {
  const md = new MarkdownIt({ html: false });
  md.use(adoRefPlugin, {
    resolver,
    isEnabled: () => enabled,
    fallbackHref: (ref: AdoRef) =>
      ref.kind === 'pullRequest'
        ? `https://example/_pr/${ref.id}`
        : `https://example/_wi/${ref.id}`,
  });
  return md;
}

describe('markdown-it ADO ref plugin', () => {
  it('matches !123 and #45 at line start', () => {
    const fake = new FakeResolver();
    const html = build(fake).render('Look at !123 and #45 today.');
    assert.match(html, /data-ado-kind="pullRequest" data-ado-id="123"/);
    assert.match(html, /data-ado-kind="workItem" data-ado-id="45"/);
    assert.deepStrictEqual(
      fake.requested.map((r) => `${r.kind}:${r.id}`),
      ['pullRequest:123', 'workItem:45'],
    );
  });

  it('does not match inside identifiers or url fragments', () => {
    const fake = new FakeResolver();
    const html = build(fake).render('foo#1 not bar!2 and http://x/page#3');
    assert.doesNotMatch(html, /ado-ref/);
    assert.strictEqual(fake.requested.length, 0);
  });

  it('does not match # followed by non-digits', () => {
    const html = build(new FakeResolver()).render('section #intro is great');
    assert.doesNotMatch(html, /ado-ref/);
  });

  it('skips when disabled', () => {
    const fake = new FakeResolver();
    const html = build(fake, false).render('Refs !1 and #2');
    assert.doesNotMatch(html, /ado-ref/);
    assert.strictEqual(fake.requested.length, 0);
  });

  it('renders cached resolved PR with status class', () => {
    const fake = new FakeResolver();
    fake.set(
      { kind: 'pullRequest', id: 7 },
      {
        state: 'resolved',
        resolvedAt: Date.now(),
        value: {
          kind: 'pullRequest',
          id: 7,
          title: 'My <PR>',
          status: 'completed',
          isDraft: false,
          url: 'https://dev.azure.com/o/p/_git/r/pullrequest/7',
        },
      },
    );
    const html = build(fake).render('See !7.');
    assert.match(html, /ado-ref--completed/);
    assert.match(html, /My &lt;PR&gt;/);
    assert.match(html, /data-ado-status="completed"/);
  });

  it('escapes html in titles and errors', () => {
    const fake = new FakeResolver();
    fake.set(
      { kind: 'workItem', id: 9 },
      { state: 'error', error: '<script>x</script>', resolvedAt: Date.now() },
    );
    const html = build(fake).render('See #9');
    assert.match(html, /title="&lt;script&gt;x&lt;\/script&gt;"/);
    assert.doesNotMatch(html, /<script>x<\/script>/);
  });
});

describe('renderRef helper', () => {
  it('emits loading state when entry is undefined', () => {
    const out = renderRef(
      { kind: 'pullRequest', id: 5 },
      undefined,
      'https://fallback/5',
      '!5',
    );
    assert.match(out, /ado-ref--loading/);
    assert.match(out, /href="https:\/\/fallback\/5"/);
    // Loading + resolved + error states all open in a new tab so the user
    // can always click through to the canonical ADO web URL.
    assert.match(out, /target="_blank"/);
    assert.match(out, /rel="noopener noreferrer"/);
  });

  it('emits an external link with target=_blank for resolved entries', () => {
    const out = renderRef(
      { kind: 'workItem', id: 7 },
      {
        state: 'resolved',
        resolvedAt: 0,
        value: {
          kind: 'workItem',
          id: 7,
          title: 'Some bug',
          state: 'Active',
          workItemType: 'Bug',
          url: 'https://dev.azure.com/myorg/p/_workitems/edit/7',
        },
      },
      'https://fallback/7',
      '#7',
    );
    assert.match(out, /href="https:\/\/dev\.azure\.com\/myorg\/p\/_workitems\/edit\/7"/);
    assert.match(out, /target="_blank"/);
    assert.match(out, /rel="noopener noreferrer"/);
  });
});
