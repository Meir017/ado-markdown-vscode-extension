# AGENTS.md

Guidance for any contributor (human or AI agent) working on this repository.

## Project shape

This is a VS Code extension that augments the **built-in markdown preview**.
It does **not** ship its own webview. We integrate via two extension points:

1. `markdown.markdownItPlugins` (+ exported `extendMarkdownIt`) — runs in the
   extension host, transforms tokens.
2. `markdown.previewScripts` — runs inside the markdown preview's webview,
   does DOM enhancement (icons / tooltips).

Plus a tiny REST client and an in-memory async resolver that bridges the two.

```
src/
  ado/         REST client + domain types       (no vscode imports)
  cache/       async resolver + cache           (no vscode imports)
  markdownIt/  markdown-it inline rule + render (no vscode imports)
  extension/   activation, config,
               workspaceContext (vscode.git remotes)
  preview/     webview-side DOM script          (browser globals only)
  test/        mocha tests for the above
```

## Activation gating

The extension's markdown-it plugin is a no-op unless an active "ADO context"
exists. A context is built from either:

1. an Azure DevOps git remote on a repo in the current workspace
   (`src/extension/workspaceContext.ts` watches the built-in `vscode.git`
   extension), or
2. an explicit `adoMarkdown.organization` setting.

`AdoWorkspaceContext` exposes `hasAny()`, `getAll()`, and `getFor(uri)`. URL
parsing lives in `src/ado/remote.ts` (pure, no vscode imports — covered by
`src/test/remote.test.ts`). Add new remote shapes there, with tests, before
touching anything else.

## Hard rules

1. **TypeScript strict.** `strict: true` in `tsconfig.json` is non-negotiable.
   No `// @ts-ignore`. Prefer narrowing over `any`.
2. **Layered dependencies.** `ado/`, `cache/`, and `markdownIt/` MUST NOT
   import from `vscode`. They are pure modules, fully unit-testable in plain
   Node mocha. Only `src/extension/**` may import `vscode`.
3. **Webview boundary.** `src/preview/**` runs in the markdown preview
   webview and MUST NOT import Node-only APIs. It is bundled with esbuild
   into a single browser IIFE.
4. **Auth via Azure CLI only.** All ADO REST calls authenticate with a
   bearer token from `@azure/identity`'s `AzureCliCredential`
   (scope `499b84ac-1321-427f-aa17-267ca6975798/.default`). Tokens are
   in-memory and per-session; never persisted, never sent to the webview.
   Failures must surface as an `AzCliAuthError` carrying a user-facing
   guidance string referencing <https://aka.ms/azcli>.
5. **Tests live next to the code they test, named `*.test.ts`** under
   `src/test/`. Every new pure module ships with a unit test.
6. **Lint clean.** `npm run lint` must pass before opening a PR.
7. **Build clean.** `npm run compile` must succeed (TS host + esbuild
   webview bundle).

## Markdown-it plugin contract

* The plugin is **synchronous**. Async work happens through the resolver:
  `peek` returns immediately; `request` schedules a fetch and triggers
  `markdown.preview.refresh` when data arrives.
* Output HTML is the contract with the webview script. Don't change the
  class names (`ado-ref`, `ado-ref--loading`, `ado-ref--error`,
  `ado-ref--<status>`) or the data attributes (`data-ado-kind`,
  `data-ado-id`, `data-ado-status`, `data-ado-state`) without updating
  `src/preview/index.ts` and `media/preview.css` together.
* Always escape HTML when interpolating user-controlled strings (titles,
  error messages, urls).
* Be conservative about what counts as a ref. The inline rule should not
  match inside words (`foo#1`), URL fragments (`page#3`), or paths
  (`docs/!1.md`). Add a regression test for each new edge case.

## Resolver contract

* `peek` is synchronous and stale-aware (TTL based).
* `request` is idempotent — calling it repeatedly while a fetch is pending
  must not start additional fetches.
* Failures are cached as `error` entries (with the same TTL semantics) to
  avoid hammering ADO when something is misconfigured.
* `onUpdate` listeners are fired in a debounced batch (50 ms) so a single
  preview render with many refs triggers exactly one refresh.

## Adding a new ADO syntax

1. Extend `AdoRef` in `src/ado/types.ts`.
2. Add a fetch method to `AdoClient` and unit test it in
   `src/test/client.test.ts` against a fake fetch.
3. Teach the inline rule in `src/markdownIt/plugin.ts` to recognize the new
   form. Add boundary tests covering false positives.
4. Extend `renderRef` to render the new entity. Add a CSS class and an icon
   in `src/preview/index.ts` if needed.
5. Wire the resolver path if the entity has a different fetch shape.

## Performance & resilience

* Markdown previews can re-render on every keystroke. Keep the inline rule
  cheap — no regex backtracking, no allocations in the hot path beyond
  what's strictly needed.
* Network failures must degrade to a plain link with the raw `!N` / `#N`
  text — never throw out of the renderer.
* Cache TTL is configurable; default 5 min. Don't bypass it without a
  user-visible command.

## Commit / PR hygiene

* Conventional-ish commits: `feat:`, `fix:`, `chore:`, `test:`, `docs:`.
* Each change to plugin output must update tests, CSS, and preview script
  in the same commit.
* Add an entry to `CHANGELOG.md` (when one exists) for user-visible changes.
