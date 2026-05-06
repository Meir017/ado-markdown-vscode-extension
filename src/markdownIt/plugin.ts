import type MarkdownIt from 'markdown-it';

import { AdoRef, Resolved } from '../ado/types';
import { CacheEntry } from '../cache/resolver';

/**
 * Interface used by the markdown-it plugin to query / request ADO data
 * without depending on the cache implementation directly. Keeps the plugin
 * unit-testable.
 */
export interface RefResolverPort {
  peek(ref: AdoRef): CacheEntry | undefined;
  request(ref: AdoRef): boolean;
}

export interface PluginOptions {
  resolver: RefResolverPort;
  /** Returns true if expansion is enabled. Re-checked at render time. */
  isEnabled: () => boolean;
  /** Build the fallback link target for a ref (used while data is loading or auth missing). */
  fallbackHref: (ref: AdoRef) => string;
}

type StateInline = MarkdownIt.StateInline;
type Token = MarkdownIt.Token;

const TOKEN_NAME = 'ado_ref';

/**
 * markdown-it plugin entry point.
 *
 * Inline rule fires on `!` or `#` and expects digits to follow. We also
 * require that the previous character is not a word char or `/`, to avoid
 * matching things like `foo#1` (anchors), `bar!2`, or `something/#3`.
 */
export function adoRefPlugin(md: MarkdownIt, options: PluginOptions): void {
  md.inline.ruler.before('emphasis', TOKEN_NAME, (state, silent) => {
    if (silent) {
      return false;
    }
    if (!options.isEnabled()) {
      return false;
    }

    const start = state.pos;
    const marker = state.src.charCodeAt(start);
    // '!' = 0x21, '#' = 0x23
    if (marker !== 0x21 && marker !== 0x23) {
      return false;
    }
    if (!isAtBoundary(state, start)) {
      return false;
    }

    let pos = start + 1;
    let digits = '';
    while (pos < state.posMax) {
      const c = state.src.charCodeAt(pos);
      if (c >= 0x30 && c <= 0x39) {
        digits += state.src[pos];
        pos += 1;
      } else {
        break;
      }
    }
    if (digits.length === 0) {
      return false;
    }
    // Avoid matching when followed by a word char (e.g. `#abc` is not `#123`).
    if (pos < state.posMax) {
      const next = state.src.charCodeAt(pos);
      if (isWordChar(next)) {
        return false;
      }
    }

    const id = parseInt(digits, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return false;
    }

    const ref: AdoRef =
      marker === 0x21
        ? { kind: 'pullRequest', id }
        : { kind: 'workItem', id };

    const token = state.push(TOKEN_NAME, '', 0);
    token.meta = { ref };
    token.markup = state.src.slice(start, pos);
    token.content = token.markup;
    state.pos = pos;
    return true;
  });

  md.renderer.rules[TOKEN_NAME] = (tokens: Token[], idx: number): string => {
    const token = tokens[idx];
    const ref = (token.meta as { ref: AdoRef }).ref;
    const entry = options.resolver.peek(ref);
    if (!entry) {
      // Schedule a fetch and render a placeholder link for this pass.
      options.resolver.request(ref);
    }
    return renderRef(ref, entry, options.fallbackHref(ref), token.markup);
  };
}

function isAtBoundary(state: StateInline, pos: number): boolean {
  if (pos === 0) {
    return true;
  }
  const prev = state.src.charCodeAt(pos - 1);
  // Don't trigger inside identifiers, urls, or fragment anchors.
  return !isWordChar(prev) && prev !== 0x2f /* / */ && prev !== 0x2e /* . */;
}

function isWordChar(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) || // 0-9
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0x61 && code <= 0x7a) || // a-z
    code === 0x5f /* _ */ ||
    code === 0x2d /* - */
  );
}

/** Exported for unit tests. */
export function renderRef(
  ref: AdoRef,
  entry: CacheEntry | undefined,
  fallbackHref: string,
  rawText: string,
): string {
  const cls = ref.kind === 'pullRequest' ? 'ado-ref ado-pr' : 'ado-ref ado-wi';
  const dataAttrs =
    `data-ado-kind="${ref.kind}" data-ado-id="${ref.id}"`;
  // External link attrs: open the canonical ADO web URL in the user's browser
  // and prevent the opened tab from accessing window.opener.
  const linkAttrs = `target="_blank" rel="noopener noreferrer"`;

  if (!entry || entry.state === 'pending') {
    const spinner = `<span class="ado-ref__spinner" aria-hidden="true"></span>`;
    return `<a class="${cls} ado-ref--loading" ${dataAttrs} ${linkAttrs} href="${escapeHtml(fallbackHref)}" title="Loading from Azure DevOps…">${spinner}<span class="ado-ref__text">${escapeHtml(rawText)}</span></a>`;
  }

  if (entry.state === 'error') {
    return `<a class="${cls} ado-ref--error" ${dataAttrs} ${linkAttrs} href="${escapeHtml(fallbackHref)}" title="${escapeHtml(entry.error)}">${escapeHtml(rawText)}</a>`;
  }

  return renderResolved(ref, entry.value, cls, dataAttrs, linkAttrs);
}

function renderResolved(
  _ref: AdoRef,
  value: Resolved,
  cls: string,
  dataAttrs: string,
  linkAttrs: string,
): string {
  const href = escapeHtml(value.url);
  if (value.kind === 'pullRequest') {
    const stateCls = `ado-ref--${value.status}`;
    const draft = value.isDraft ? ' (draft)' : '';
    return (
      `<a class="${cls} ${stateCls}" ${dataAttrs} ${linkAttrs} data-ado-status="${value.status}"` +
      ` href="${href}" title="${escapeHtml(`Pull request ${value.status}${draft}`)}">` +
      `<span class="ado-ref__icon" aria-hidden="true"></span>` +
      `<span class="ado-ref__kind-icon" aria-hidden="true"></span>` +
      `<span class="ado-ref__id">!${value.id}</span> ` +
      `<span class="ado-ref__title">${escapeHtml(value.title)}${draft ? ' <em>(draft)</em>' : ''}</span>` +
      `</a>`
    );
  }
  // work item
  const stateLabel = value.state;
  const iconHtml = value.iconDataUri
    ? `<span class="ado-ref__icon" data-decorated="1" aria-hidden="true">` +
      `<img class="ado-ref__icon-img" src="${escapeHtml(value.iconDataUri)}" alt=""/>` +
      `</span>`
    : `<span class="ado-ref__icon" aria-hidden="true"></span>`;
  return (
    `<a class="${cls} ado-ref--${slug(stateLabel)}" ${dataAttrs} ${linkAttrs} data-ado-state="${escapeHtml(stateLabel)}"` +
    ` data-ado-type="${escapeHtml(value.workItemType)}"` +
    ` href="${href}" title="${escapeHtml(`${value.workItemType} • ${stateLabel}`)}">` +
    iconHtml +
    `<span class="ado-ref__id">#${value.id}</span> ` +
    `<span class="ado-ref__title">${escapeHtml(value.title)}</span> ` +
    `<span class="ado-ref__state">${escapeHtml(stateLabel)}</span>` +
    `</a>`
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
