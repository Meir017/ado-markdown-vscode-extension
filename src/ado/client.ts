import { AzCliAuthError, TokenProvider } from './tokenProvider';
import {
  AdoConnectionConfig,
  PullRequestStatus,
  ResolvedPullRequest,
  ResolvedWorkItem,
} from './types';

/**
 * Minimal Azure DevOps REST client. Authenticates via a `TokenProvider`
 * (typically `AzureCliTokenProvider`) and emits `Authorization: Bearer …`
 * headers per request.
 *
 * We deliberately avoid the official `azure-devops-node-api` package — it
 * carries a lot of weight for two endpoints, and a fetch-based client is
 * trivial to mock in tests.
 */

const API_VERSION = '7.1';

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  headers?: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface FetchLike {
  (
    input: string,
    init?: { headers?: Record<string, string> },
  ): Promise<FetchResponseLike>;
}

export class AdoClient {
  private readonly config: AdoConnectionConfig;
  private readonly tokenProvider: TokenProvider;
  private readonly fetchImpl: FetchLike;
  /**
   * In-process cache of work-item type icon data URIs, keyed by
   * `${project}/${type}`. Resolves to a base64 data URI on success or to
   * `null` on a known failure (so we don't repeatedly re-fetch).
   */
  private readonly typeIconCache = new Map<string, Promise<string | null>>();

  constructor(
    config: AdoConnectionConfig,
    tokenProvider: TokenProvider,
    fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  ) {
    this.config = config;
    this.tokenProvider = tokenProvider;
    this.fetchImpl = fetchImpl;
  }

  async getWorkItem(id: number): Promise<ResolvedWorkItem> {
    const url =
      `${this.baseOrgUrl()}/_apis/wit/workitems/${id}` +
      `?fields=System.Title,System.State,System.WorkItemType,System.TeamProject` +
      `&api-version=${API_VERSION}`;
    const data = (await this.get(url)) as {
      id: number;
      fields: Record<string, string>;
      _links?: { html?: { href?: string } };
    };
    const workItemType = data.fields['System.WorkItemType'] ?? 'Work Item';
    const project =
      data.fields['System.TeamProject'] ?? this.config.project;
    const iconDataUri = await this.getWorkItemTypeIcon(project, workItemType).catch(
      () => null,
    );
    return {
      kind: 'workItem',
      id: data.id,
      title: data.fields['System.Title'] ?? `Work Item ${id}`,
      state: data.fields['System.State'] ?? 'Unknown',
      workItemType,
      url:
        data._links?.html?.href ??
        `${this.baseOrgUrl()}/${encodeURIComponent(project)}/_workitems/edit/${id}`,
      ...(iconDataUri ? { iconDataUri } : {}),
    };
  }

  /**
   * Fetches the SVG icon ADO uses for a given work-item type in a project
   * (e.g. Bug → red insect, Story → green book) and returns it as a
   * `data:image/svg+xml;base64,…` URI safe to embed in `<img src>`. Cached
   * per (project, type) for the lifetime of the client. Returns `null` on
   * any failure so the renderer can fall back to its generic icon.
   */
  async getWorkItemTypeIcon(project: string, type: string): Promise<string | null> {
    const key = `${project}\u0001${type}`;
    let promise = this.typeIconCache.get(key);
    if (!promise) {
      promise = this.fetchWorkItemTypeIcon(project, type).catch(() => null);
      this.typeIconCache.set(key, promise);
    }
    return promise;
  }

  private async fetchWorkItemTypeIcon(
    project: string,
    type: string,
  ): Promise<string | null> {
    if (!project || !type) {
      return null;
    }
    const metaUrl =
      `${this.baseOrgUrl()}/${encodeURIComponent(project)}` +
      `/_apis/wit/workitemtypes/${encodeURIComponent(type)}?api-version=${API_VERSION}`;
    const meta = (await this.get(metaUrl)) as {
      color?: string;
      icon?: { id?: string };
    };
    const iconId = meta.icon?.id;
    if (!iconId) {
      return null;
    }
    // ADO returns colors as 8-char `AARRGGBB`. The icon endpoint expects an
    // `RRGGBB` color, so drop a leading alpha pair if present.
    const rawColor = meta.color ?? '';
    const color = rawColor.length === 8 ? rawColor.slice(2) : rawColor;
    const iconUrl =
      `${this.baseOrgUrl()}/_apis/wit/workItemIcons/${encodeURIComponent(iconId)}` +
      `?api-version=${API_VERSION}` +
      (color ? `&color=${encodeURIComponent(color)}` : '');
    const svg = await this.getSvg(iconUrl);
    if (!svg) {
      return null;
    }
    const base64 = encodeBase64Utf8(svg);
    return `data:image/svg+xml;base64,${base64}`;
  }

  async getPullRequest(id: number): Promise<ResolvedPullRequest> {
    // The org-scoped endpoint resolves a PR by id without needing the repo id.
    const url =
      `${this.baseOrgUrl()}/_apis/git/pullrequests/${id}` +
      `?api-version=${API_VERSION}`;
    const data = (await this.get(url)) as {
      pullRequestId: number;
      title: string;
      status: string;
      isDraft?: boolean;
      repository?: { name?: string; project?: { name?: string } };
    };
    const project = data.repository?.project?.name ?? this.config.project;
    const repo = data.repository?.name ?? '';
    return {
      kind: 'pullRequest',
      id: data.pullRequestId,
      title: data.title ?? `Pull Request ${id}`,
      status: normalizeStatus(data.status),
      isDraft: !!data.isDraft,
      repository: repo,
      url: repo
        ? `${this.baseOrgUrl()}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequest/${id}`
        : `${this.baseOrgUrl()}/${encodeURIComponent(project)}/_git/_pullrequest/${id}`,
    };
  }

  private baseOrgUrl(): string {
    return `https://dev.azure.com/${encodeURIComponent(this.config.organization)}`;
  }

  private async get(url: string): Promise<unknown> {
    const authorization = await this.tokenProvider.getAuthHeader();
    const res = await this.fetchImpl(url, {
      headers: {
        Accept: 'application/json;api-version=' + API_VERSION,
        Authorization: authorization,
      },
    });
    if (res.status === 401 || res.status === 403) {
      throw new AzCliAuthError(
        `Azure DevOps authentication failed (${res.status}). ` +
          `Run 'az login' and ensure your account has access to ` +
          `'${this.config.organization}'.`,
      );
    }
    if (!res.ok) {
      throw new Error(`ADO request failed (${res.status} ${res.statusText}): ${url}`);
    }
    // Defensive: if ADO ever returns HTML on a "successful" status (e.g. a
    // sign-in redirect served as 200/203), surface it as an actionable auth
    // error rather than letting JSON.parse blow up with "Unexpected token <".
    const contentType = res.headers?.get('content-type') ?? '';
    const body = await res.text();
    if (
      contentType.toLowerCase().includes('text/html') ||
      /^\s*<(?:!doctype|html|head)/i.test(body)
    ) {
      throw new AzCliAuthError(
        `Azure DevOps returned an HTML page for '${this.config.organization}'. ` +
          `Run 'az login' and verify access with: ` +
          `az account get-access-token --scope 499b84ac-1321-427f-aa17-267ca6975798/.default`,
      );
    }
    try {
      return JSON.parse(body) as unknown;
    } catch (err) {
      throw new Error(
        `ADO request returned non-JSON response (${res.status} ${res.statusText}) ` +
          `from ${url}: ${(err as Error).message}`,
      );
    }
  }

  private async getSvg(url: string): Promise<string | null> {
    const authorization = await this.tokenProvider.getAuthHeader();
    const res = await this.fetchImpl(url, {
      headers: {
        Accept: 'image/svg+xml,*/*;q=0.8',
        Authorization: authorization,
      },
    });
    if (!res.ok) {
      return null;
    }
    const body = await res.text();
    // Reject anything that doesn't look like an SVG document.
    if (!/^\s*<\?xml|^\s*<svg[\s>]/i.test(body)) {
      return null;
    }
    return body;
  }
}

function encodeBase64Utf8(input: string): string {
  // Buffer is available in the extension host (Node). The extension always
  // runs in Node so we don't need a browser btoa fallback here.
  return Buffer.from(input, 'utf8').toString('base64');
}

export function normalizeStatus(raw: string | undefined): PullRequestStatus {
  switch ((raw ?? '').toLowerCase()) {
    case 'active':
      return 'active';
    case 'completed':
      return 'completed';
    case 'abandoned':
      return 'abandoned';
    default:
      return 'unknown';
  }
}
