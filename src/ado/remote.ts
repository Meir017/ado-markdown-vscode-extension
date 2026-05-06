/**
 * Pure parser for Azure DevOps git remote URLs. No vscode imports —
 * unit-testable in plain Node.
 *
 * Supported forms:
 *   - https://dev.azure.com/{org}/{project}/_git/{repo}
 *   - https://{user}@dev.azure.com/{org}/{project}/_git/{repo}
 *   - https://{org}.visualstudio.com/{project}/_git/{repo}
 *   - https://{org}.visualstudio.com/DefaultCollection/{project}/_git/{repo}
 *   - git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
 *   - {org}@vs-ssh.visualstudio.com:v3/{org}/{project}/{repo}
 */

export interface AdoRemote {
  organization: string;
  project: string;
  repository: string;
}

export function parseAdoRemote(rawUrl: string): AdoRemote | undefined {
  if (!rawUrl) {
    return undefined;
  }
  const url = rawUrl.trim().replace(/\.git$/i, '');

  // SSH: git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
  let m = /^[^@]+@ssh\.dev\.azure\.com:v\d+\/([^/]+)\/([^/]+)\/([^/]+)$/i.exec(url);
  if (m) {
    return decode({ organization: m[1], project: m[2], repository: m[3] });
  }

  // SSH legacy: {x}@vs-ssh.visualstudio.com:v3/{org}/{project}/{repo}
  m = /^[^@]+@vs-ssh\.([^.]+)\.visualstudio\.com:v\d+\/([^/]+)\/([^/]+)\/([^/]+)$/i.exec(url);
  if (m) {
    return decode({ organization: m[2], project: m[3], repository: m[4] });
  }
  m = /^[^@]+@vs-ssh\.visualstudio\.com:v\d+\/([^/]+)\/([^/]+)\/([^/]+)$/i.exec(url);
  if (m) {
    return decode({ organization: m[1], project: m[2], repository: m[3] });
  }

  // HTTPS forms — parse as URL.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }

  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split('/').filter(Boolean);

  if (host === 'dev.azure.com' || host === 'www.dev.azure.com') {
    // /{org}/{project}/_git/{repo}
    const gitIdx = segments.indexOf('_git');
    if (gitIdx >= 2 && gitIdx + 1 < segments.length) {
      return decode({
        organization: segments[0],
        project: segments.slice(1, gitIdx).join('/'),
        repository: segments[gitIdx + 1],
      });
    }
  }

  if (host.endsWith('.visualstudio.com')) {
    const org = host.slice(0, -'.visualstudio.com'.length);
    // optional DefaultCollection prefix
    const start = segments[0]?.toLowerCase() === 'defaultcollection' ? 1 : 0;
    const gitIdx = segments.indexOf('_git', start);
    if (gitIdx > start && gitIdx + 1 < segments.length) {
      return decode({
        organization: org,
        project: segments.slice(start, gitIdx).join('/'),
        repository: segments[gitIdx + 1],
      });
    }
  }

  return undefined;
}

function decode(r: AdoRemote): AdoRemote {
  return {
    organization: safeDecode(r.organization),
    project: safeDecode(r.project),
    repository: safeDecode(r.repository),
  };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
