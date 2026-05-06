/**
 * Domain types for ADO entities. Kept independent of vscode API
 * so the data layer can be unit-tested in plain Node.
 */

export type PullRequestStatus = 'active' | 'completed' | 'abandoned' | 'unknown';

export interface WorkItemRef {
  kind: 'workItem';
  id: number;
}

export interface PullRequestRef {
  kind: 'pullRequest';
  id: number;
}

export type AdoRef = WorkItemRef | PullRequestRef;

export interface ResolvedWorkItem {
  kind: 'workItem';
  id: number;
  title: string;
  state: string;
  workItemType: string;
  url: string;
  /**
   * Optional `data:image/svg+xml;base64,…` URI of the work-item type's
   * Azure DevOps icon (the same icon ADO uses in the web UI). When absent
   * the renderer falls back to a generic outline icon.
   */
  iconDataUri?: string;
}

export interface ResolvedPullRequest {
  kind: 'pullRequest';
  id: number;
  title: string;
  status: PullRequestStatus;
  /** True if the PR is a draft. */
  isDraft: boolean;
  url: string;
  /** Repository name as reported by ADO. */
  repository?: string;
}

export type Resolved = ResolvedWorkItem | ResolvedPullRequest;

export interface AdoConnectionConfig {
  organization: string;
  project: string;
}
