/**
 * Webview-side enhancement script for the markdown preview.
 *
 * The markdown-it plugin (extension host) emits `<a class="ado-ref ...">`
 * elements with `data-ado-kind` / `data-ado-id` / `data-ado-status` attributes
 * already populated. This script:
 *
 *   1. Injects an inline SVG icon for resolved refs (status icon for PRs,
 *      type icon for work items) so the rendered output stays self-contained.
 *   2. Rewires clicks to open the canonical href in a new tab.
 *
 * It re-runs whenever VS Code emits the `vscode.markdown.updateContent` event,
 * mirroring `vscode-markdown-mermaid`.
 */

interface IconSet {
  [key: string]: string;
}

const PR_ICONS: IconSet = {
  active:
    '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 4v5l3 2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
  completed:
    '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 8l3 3 7-7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  abandoned:
    '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
  unknown:
    '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2"/><text x="8" y="11" text-anchor="middle" font-size="9" fill="currentColor">?</text></svg>',
};

const WORK_ITEM_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="2" y="3" width="12" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 7h6M5 10h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

// GitHub-style "git-pull-request" octicon (two circles connected by a branch
// arm). Rendered right after the status icon so PR refs are visually
// distinguishable at a glance.
const PR_KIND_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
  '<path fill="currentColor" d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/>' +
  '</svg>';

function decorate(): void {
  const refs = document.querySelectorAll<HTMLElement>('a.ado-ref');
  refs.forEach((el) => {
    const iconHost = el.querySelector<HTMLElement>('.ado-ref__icon');
    if (iconHost && iconHost.dataset.decorated !== '1') {
      const kind = el.dataset.adoKind;
      if (kind === 'pullRequest') {
        const status = (el.dataset.adoStatus ?? 'unknown') as keyof typeof PR_ICONS;
        iconHost.innerHTML = PR_ICONS[status] ?? PR_ICONS.unknown;
      } else if (kind === 'workItem') {
        iconHost.innerHTML = WORK_ITEM_ICON;
      }
      iconHost.dataset.decorated = '1';
    }
    // PR refs also carry a kind icon (the git-pull-request glyph) rendered
    // right after the status icon.
    const kindHost = el.querySelector<HTMLElement>('.ado-ref__kind-icon');
    if (kindHost && kindHost.dataset.decorated !== '1') {
      if (el.dataset.adoKind === 'pullRequest') {
        kindHost.innerHTML = PR_KIND_ICON;
      }
      kindHost.dataset.decorated = '1';
    }
  });
}

window.addEventListener('vscode.markdown.updateContent', decorate);
decorate();
