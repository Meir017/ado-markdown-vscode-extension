import * as vscode from 'vscode';

import { AdoRemote, parseAdoRemote } from '../ado/remote';

/**
 * Minimal subset of the built-in `vscode.git` extension API we depend on.
 * See https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
 */
interface GitExtensionApi {
  repositories: Array<{
    rootUri: vscode.Uri;
    state: {
      remotes: Array<{
        name: string;
        fetchUrl?: string;
        pushUrl?: string;
      }>;
      onDidChange: vscode.Event<void>;
    };
  }>;
  onDidOpenRepository: vscode.Event<unknown>;
  onDidCloseRepository: vscode.Event<unknown>;
}

interface GitExtension {
  readonly enabled: boolean;
  readonly onDidChangeEnablement: vscode.Event<boolean>;
  getAPI(version: 1): GitExtensionApi;
}

export interface DetectedAdoContext extends AdoRemote {
  rootUri: vscode.Uri;
}

/**
 * Watches the workspace for Azure DevOps git remotes. Provides a synchronous
 * snapshot of the currently detected contexts plus an event that fires when
 * the snapshot changes.
 */
export class AdoWorkspaceContext implements vscode.Disposable {
  private contexts: DetectedAdoContext[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly repoListenerDisposables = new Map<string, vscode.Disposable>();

  readonly onDidChange = this.emitter.event;

  static async create(): Promise<AdoWorkspaceContext> {
    const ctx = new AdoWorkspaceContext();
    await ctx.start();
    return ctx;
  }

  /** Currently detected ADO contexts. Empty when no ADO repo is open. */
  getAll(): readonly DetectedAdoContext[] {
    return this.contexts;
  }

  /** Returns the best ADO context for a given resource (closest enclosing repo), or the first if none match. */
  getFor(resource?: vscode.Uri): DetectedAdoContext | undefined {
    if (!this.contexts.length) {
      return undefined;
    }
    if (!resource) {
      return this.contexts[0];
    }
    const target = resource.fsPath.toLowerCase();
    let best: DetectedAdoContext | undefined;
    let bestLen = -1;
    for (const c of this.contexts) {
      const root = c.rootUri.fsPath.toLowerCase();
      if (target.startsWith(root) && root.length > bestLen) {
        best = c;
        bestLen = root.length;
      }
    }
    return best ?? this.contexts[0];
  }

  hasAny(): boolean {
    return this.contexts.length > 0;
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    for (const d of this.repoListenerDisposables.values()) {
      d.dispose();
    }
    this.repoListenerDisposables.clear();
    this.emitter.dispose();
  }

  private async start(): Promise<void> {
    const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!ext) {
      return;
    }
    const gitExt = ext.isActive ? ext.exports : await ext.activate();
    if (!gitExt.enabled) {
      this.disposables.push(
        gitExt.onDidChangeEnablement((enabled) => {
          if (enabled) {
            this.bind(gitExt);
          }
        }),
      );
      return;
    }
    this.bind(gitExt);
  }

  private bind(gitExt: GitExtension): void {
    const api = gitExt.getAPI(1);
    this.refresh(api);
    this.disposables.push(
      api.onDidOpenRepository(() => this.refresh(api)),
      api.onDidCloseRepository(() => this.refresh(api)),
    );
  }

  private refresh(api: GitExtensionApi): void {
    // Re-subscribe to per-repo state changes so renamed/added remotes are picked up.
    for (const d of this.repoListenerDisposables.values()) {
      d.dispose();
    }
    this.repoListenerDisposables.clear();

    const next: DetectedAdoContext[] = [];
    for (const repo of api.repositories) {
      this.repoListenerDisposables.set(
        repo.rootUri.toString(),
        repo.state.onDidChange(() => this.refresh(api)),
      );
      const remotes = repo.state.remotes;
      // Prefer 'origin' if present; otherwise the first ADO remote we find.
      const ordered = [...remotes].sort((a, b) =>
        (a.name === 'origin' ? -1 : 0) - (b.name === 'origin' ? -1 : 0),
      );
      for (const remote of ordered) {
        const url = remote.fetchUrl ?? remote.pushUrl;
        if (!url) {
          continue;
        }
        const parsed = parseAdoRemote(url);
        if (parsed) {
          next.push({ ...parsed, rootUri: repo.rootUri });
          break;
        }
      }
    }

    if (sameContexts(this.contexts, next)) {
      return;
    }
    this.contexts = next;
    this.emitter.fire();
  }
}

function sameContexts(a: readonly DetectedAdoContext[], b: readonly DetectedAdoContext[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].organization !== b[i].organization ||
      a[i].project !== b[i].project ||
      a[i].repository !== b[i].repository ||
      a[i].rootUri.toString() !== b[i].rootUri.toString()
    ) {
      return false;
    }
  }
  return true;
}
