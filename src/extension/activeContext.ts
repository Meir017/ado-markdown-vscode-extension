import { AdoRef } from '../ado/types';

/** Pure config-shape consumed by the resolver-build step. */
export interface ConfigInput {
  enabled: boolean;
  organization: string;
  project: string;
}

/** A detected ADO context contributed by an open git repo. */
export interface DetectedContextInput {
  organization: string;
  project: string;
}

/**
 * The decision the extension makes for "what org/project should we resolve
 * against right now?". Settings always win; otherwise, the first detected
 * ADO repo is used. When neither yields an organization, `enabled` is false
 * and the plugin stays inactive.
 */
export interface ActiveAdoContext {
  enabled: boolean;
  organization: string;
  project: string;
  /** Where the active org/project came from. Useful for diagnostics. */
  source: 'config' | 'detected' | 'none';
}

/**
 * Decide which ADO org/project the extension should target.
 *
 * Precedence:
 *   1. `adoMarkdown.organization` (and optionally `adoMarkdown.project`)
 *      always win when set. This is how users target ADO from a non-ADO
 *      workspace (e.g. a GitHub clone) or override autodetection to point
 *      at a different org.
 *   2. Otherwise the first detected ADO git remote is used.
 *   3. If neither yields an organization, the plugin stays inactive.
 *
 * `project` may legitimately be empty: org-scoped REST endpoints
 * (`/_apis/wit/workitems/{id}`, `/_apis/git/pullrequests/{id}`) do not
 * require it. The fallback-link builder degrades gracefully when project
 * is missing.
 */
export function resolveActiveContext(
  config: ConfigInput,
  detected: readonly DetectedContextInput[],
): ActiveAdoContext {
  if (!config.enabled) {
    return { enabled: false, organization: '', project: '', source: 'none' };
  }

  const explicitOrg = config.organization.trim();
  const explicitProject = config.project.trim();

  if (explicitOrg) {
    return {
      enabled: true,
      organization: explicitOrg,
      // Allow the explicit project to override; otherwise fall back to the
      // detected project only when the detected org *matches* the explicit
      // one (avoids silently mixing project names from a different org).
      project:
        explicitProject ||
        (detected.find((d) => sameOrg(d.organization, explicitOrg))?.project ?? ''),
      source: 'config',
    };
  }

  const first = detected[0];
  if (first?.organization) {
    return {
      enabled: true,
      organization: first.organization,
      project: explicitProject || first.project || '',
      source: 'detected',
    };
  }

  return { enabled: false, organization: '', project: '', source: 'none' };
}

/**
 * Best-effort web URL used while a ref is still loading or as a click
 * target when no org is configured. With an org, points at ADO's search
 * UI when the project is unknown so the link still goes somewhere useful.
 */
export function buildFallbackHref(
  ref: AdoRef,
  ctx: { organization: string; project: string },
): string {
  const org = ctx.organization;
  if (!org) {
    return ref.kind === 'workItem'
      ? 'https://dev.azure.com/'
      : 'https://dev.azure.com/';
  }

  const orgBase = `https://dev.azure.com/${encodeURIComponent(org)}`;
  const project = ctx.project ? encodeURIComponent(ctx.project) : '';

  if (ref.kind === 'workItem') {
    // Org-scoped work-item edit URL works without a project segment.
    return project
      ? `${orgBase}/${project}/_workitems/edit/${ref.id}`
      : `${orgBase}/_workitems/edit/${ref.id}`;
  }
  // Pull requests *require* a project segment in the web UI. When unknown,
  // route the user to the org-wide pull-request hub so they can search.
  return project
    ? `${orgBase}/${project}/_git/_pullrequest/${ref.id}`
    : `${orgBase}/_pulls?_a=mine`;
}

function sameOrg(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
