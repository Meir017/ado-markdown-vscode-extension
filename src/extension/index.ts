import * as vscode from 'vscode';
import type MarkdownIt from 'markdown-it';

import { AdoClient } from '../ado/client';
import { AzureCliTokenProvider } from '../ado/tokenProvider';
import { AdoRef } from '../ado/types';
import { AdoResolver } from '../cache/resolver';
import { adoRefPlugin } from '../markdownIt/plugin';
import { CONFIG_SECTION, ExtensionConfig, readConfig } from './config';
import { AdoWorkspaceContext } from './workspaceContext';

let resolver: AdoResolver | undefined;
let workspaceCtx: AdoWorkspaceContext | undefined;
let tokenProvider: AzureCliTokenProvider | undefined;
let activeOrg = '';
let activeProject = '';
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
        fallbackHref: (ref: AdoRef) => buildFallbackHref(ref),
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
  if (!currentConfig.enabled || !tokenProvider) {
    resolver = undefined;
    activeOrg = '';
    activeProject = '';
    return;
  }

  const detected = workspaceCtx?.getAll() ?? [];
  const detectedOrg = detected[0]?.organization ?? '';
  const detectedProject = detected[0]?.project ?? '';

  const org = currentConfig.organization || detectedOrg;
  const project = currentConfig.project || detectedProject;

  if (!org) {
    // No ADO repo open and no override — stay quiet.
    resolver = undefined;
    activeOrg = '';
    activeProject = '';
    return;
  }

  activeOrg = org;
  activeProject = project;
  const client = new AdoClient({ organization: org, project }, tokenProvider);
  resolver = new AdoResolver(client, { ttlMs: currentConfig.cacheTtlSeconds * 1000 });
  resolver.onUpdate(() => {
    void vscode.commands.executeCommand('markdown.preview.refresh');
  });
}

function buildFallbackHref(ref: AdoRef): string {
  const org = activeOrg || 'dev.azure.com';
  const project = encodeURIComponent(activeProject || '');
  const base = `https://dev.azure.com/${encodeURIComponent(org)}/${project}`;
  if (ref.kind === 'workItem') {
    return `${base}/_workitems/edit/${ref.id}`;
  }
  return `${base}/_git/_pullrequest/${ref.id}`;
}
