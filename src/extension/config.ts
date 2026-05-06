import * as vscode from 'vscode';

export interface ExtensionConfig {
  enabled: boolean;
  organization: string;
  project: string;
  cacheTtlSeconds: number;
}

export const CONFIG_SECTION = 'adoMarkdown';

export function readConfig(): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    enabled: cfg.get<boolean>('enabled', true),
    organization: cfg.get<string>('organization', '').trim(),
    project: cfg.get<string>('project', '').trim(),
    cacheTtlSeconds: Math.max(10, cfg.get<number>('cacheTtlSeconds', 300)),
  };
}
