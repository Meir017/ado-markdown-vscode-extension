# ADO Markdown Preview

[![CI](https://github.com/Meir017/ado-markdown-vscode-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/Meir017/ado-markdown-vscode-extension/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Meir017/ado-markdown-vscode-extension?include_prereleases&sort=semver)](https://github.com/Meir017/ado-markdown-vscode-extension/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Enhances the built-in VS Code markdown preview to expand Azure DevOps
shortlink syntaxes inline:

![Demo](./media/vscode-markdown-previewer-ado.gif)


| Syntax | Renders as |
| ------ | ---------- |
| `#123` | `🗒 #123 — <work item title> · <state>` |
| `!123` | `<status icon> !123 — <pull request title>` |

Inspired by [`mjbvz/vscode-markdown-mermaid`](https://github.com/mjbvz/vscode-markdown-mermaid).

## Activation

The extension activates whenever **either** of the following is true:

1. The open VS Code workspace contains a git repository whose remote points
   at Azure DevOps (`dev.azure.com/{org}/...` or `{org}.visualstudio.com/...`,
   including the SSH variants). The detected organization/project are used
   to resolve `#N` and `!N` automatically — no configuration required.
2. You set `adoMarkdown.organization` (and optionally `adoMarkdown.project`)
   in your settings. This lets you target Azure DevOps from any workspace
   — for example a **GitHub clone** that needs to reference the team's ADO
   work items, or to point at a **different org** than the one detected
   from the git remote.

Explicit settings always win over auto-detection. If neither yields an
organization, the plugin stays inactive and `#N` / `!N` are left as plain
text.

## Setup

This extension authenticates to Azure DevOps using your existing
[**Azure CLI**](https://aka.ms/azcli) login. There is no PAT to manage.

1. Install the Azure CLI from <https://aka.ms/azcli> if you don't have it.
2. Sign in once: `az login`.
3. Open a folder cloned from Azure DevOps (org auto-detected from the git
   remote).
4. Open any markdown file. `#123` and `!123` will resolve in the preview.

If you see *“Azure CLI not available — install from https://aka.ms/azcli
and run 'az login'.”* on hover, `az` is missing from your PATH or your
session has expired. Verify auth manually with:

```bash
az account get-access-token --scope 499b84ac-1321-427f-aa17-267ca6975798/.default
```

Tokens are obtained through `@azure/identity`'s `AzureCliCredential`,
cached in-memory by the extension host, and never persisted to disk.

## Commands

| Command | What it does |
| ------- | ------------ |
| `ADO Markdown: Clear Cache` | Drops the in-memory cache and re-renders. |

## Settings

| Setting | Default | Notes |
| ------- | ------- | ----- |
| `adoMarkdown.enabled` | `true` | Toggle expansion entirely. |
| `adoMarkdown.organization` | `""` | The part after `dev.azure.com/`. |
| `adoMarkdown.project` | `""` | Default project for fallback links. |
| `adoMarkdown.cacheTtlSeconds` | `300` | TTL for resolved data. |

## Development

```bash
npm install
npm run compile   # tsc + esbuild bundle for preview
npm run lint
npm test
```

Press **F5** in VS Code to launch an Extension Development Host.

See `AGENTS.md` for architecture, layering rules, and
contribution patterns.
