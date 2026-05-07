import * as vscode from 'vscode';
import type MarkdownIt from 'markdown-it';

import { AdoClient } from '../ado/client';
import { AzureCliTokenProvider } from '../ado/tokenProvider';
import { AdoRef } from '../ado/types';
import { AdoResolver } from '../cache/resolver';
import { adoRefPlugin } from '../markdownIt/plugin';
import {
  ActiveAdoContext,
  buildFallbackHref,
  resolveActiveContext,
} from './activeContext';
import { CONFIG_SECTION, ExtensionConfig, readConfig } from './config';
import { AdoWorkspaceContext } from './workspaceContext';

let resolver: AdoResolver | undefined;
let workspaceCtx: AdoWorkspaceContext | undefined;
let tokenProvider: AzureCliTokenProvider | undefined;
let activeContext: ActiveAdoContext = {
  enabled: false,
  organization: '',
  project: '',
  source: 'none',
};
let currentConfig: ExtensionConfig = {
  enabled: false,
  organization: '',
  project: '',
  cacheTtlSeconds: 300,
};

export async function activate(context: vscode.ExtensionContext): Promise<{
  extendMarkdownIt(md: MarkdownIt): MarkdownIt;
}> {
  currentConfig = readConfig();
  // Single shared token provider — caches the Azure CLI access token across
  // every ADO request the resolver makes.
  tokenProvider = new AzureCliTokenProvider();
  workspaceCtx = await AdoWorkspaceContext.create();
  rebuildResolver();

  context.subscriptions.push(
    workspaceCtx,
    workspaceCtx.onDidChange(() => {
      rebuildResolver();
      void vscode.commands.executeCommand('markdown.preview.refresh');
    }),
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration(CONFIG_SECTION)) {
        currentConfig = readConfig();
        rebuildResolver();
        await vscode.commands.executeCommand('markdown.preview.refresh');
      }
    }),
    vscode.commands.registerCommand('adoMarkdown.clearCache', () => {
      resolver?.clear();
      void vscode.commands.executeCommand('markdown.preview.refresh');
    }),
  );

  return {
    extendMarkdownIt(md: MarkdownIt): MarkdownIt {
      return md.use(adoRefPlugin, {
        resolver: {
          peek: (ref: AdoRef) => resolver?.peek(ref),
          request: (ref: AdoRef) => resolver?.request(ref) ?? false,
        },
        isEnabled: () => currentConfig.enabled && !!resolver,
        fallbackHref: (ref: AdoRef) =>
          buildFallbackHref(ref, {
            organization: activeContext.organization,
            project: activeContext.project,
          }),
      });
    },
  };
}

export function deactivate(): void {
  resolver = undefined;
  workspaceCtx?.dispose();
  workspaceCtx = undefined;
  tokenProvider = undefined;
}

/**
 * Rebuild the resolver based on the active ADO context. Plugin only resolves
 * when (a) the workspace contains an ADO git remote, OR (b) the user has
 * explicitly configured `adoMarkdown.organization`. In both cases settings
 * win over autodetection so users can override.
 */
function rebuildResolver(): void {
  if (!tokenProvider) {
    resolver = undefined;
    activeContext = { enabled: false, organization: '', project: '', source: 'none' };
    return;
  }

  const detected = workspaceCtx?.getAll() ?? [];
  activeContext = resolveActiveContext(currentConfig, detected);

  if (!activeContext.enabled) {
    resolver = undefined;
    return;
  }

  const client = new AdoClient(
    { organization: activeContext.organization, project: activeContext.project },
    tokenProvider,
  );
  resolver = new AdoResolver(client, { ttlMs: currentConfig.cacheTtlSeconds * 1000 });
  resolver.onUpdate(() => {
    void vscode.commands.executeCommand('markdown.preview.refresh');
  });
}
