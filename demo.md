# ADO Markdown demo

Drop your real org's IDs in here and open the **Markdown Preview**
(<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd>).

## Pull requests

- See the recent fix in !1 — should render with a status icon.
- Compare against !2 and !3.

## Work items

- Bug #1 should expand inline.
- Tasks #2, #3, and #100 each render with type + state.

## Negative cases (should stay plain text)

- A URL fragment like `https://example.com/page#1` must not match.
- Identifiers like `foo#1` or `bar!2` must not match.
- `#intro` (non-numeric) must not match.

> The extension only activates when this workspace's git remote points at
> Azure DevOps. If you opened the extension repo itself (a GitHub remote),
> set `adoMarkdown.organization` in settings to force activation, or open a
> folder cloned from `dev.azure.com`.
