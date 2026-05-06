import { AdoClient } from '../ado/client';
import { AdoRef, Resolved } from '../ado/types';

/**
 * Resolves ADO refs and caches the result. The markdown-it plugin runs
 * synchronously, so the contract is:
 *
 *   - `peek(ref)` is sync; returns cached entry or `undefined`.
 *   - `request(ref)` queues a background fetch; on completion the cache is
 *     populated and the `onUpdate` listener fires so the caller can refresh
 *     the markdown preview.
 */

export type CacheEntry =
  | { state: 'pending' }
  | { state: 'resolved'; value: Resolved; resolvedAt: number }
  | { state: 'error'; error: string; resolvedAt: number };

export interface ResolverOptions {
  ttlMs: number;
}

function refKey(ref: AdoRef): string {
  return `${ref.kind}:${ref.id}`;
}

export class AdoResolver {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly listeners = new Set<() => void>();
  private updateScheduled = false;
  private readonly client: AdoClient;
  private readonly options: ResolverOptions;

  constructor(client: AdoClient, options: ResolverOptions) {
    this.client = client;
    this.options = options;
  }

  onUpdate(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  peek(ref: AdoRef): CacheEntry | undefined {
    const entry = this.cache.get(refKey(ref));
    if (!entry) {
      return undefined;
    }
    if (entry.state !== 'pending' && Date.now() - entry.resolvedAt > this.options.ttlMs) {
      this.cache.delete(refKey(ref));
      return undefined;
    }
    return entry;
  }

  /** Returns true if a fetch was started. */
  request(ref: AdoRef): boolean {
    const key = refKey(ref);
    const existing = this.peek(ref);
    if (existing) {
      return false;
    }
    this.cache.set(key, { state: 'pending' });
    void this.fetch(ref).catch(() => { /* errors recorded in fetch */ });
    return true;
  }

  clear(): void {
    this.cache.clear();
    this.notify();
  }

  private async fetch(ref: AdoRef): Promise<void> {
    const key = refKey(ref);
    try {
      const value =
        ref.kind === 'workItem'
          ? await this.client.getWorkItem(ref.id)
          : await this.client.getPullRequest(ref.id);
      this.cache.set(key, { state: 'resolved', value, resolvedAt: Date.now() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.cache.set(key, { state: 'error', error: message, resolvedAt: Date.now() });
    } finally {
      this.scheduleNotify();
    }
  }

  private scheduleNotify(): void {
    // Coalesce rapid updates from a batch of fetches into a single refresh.
    if (this.updateScheduled) {
      return;
    }
    this.updateScheduled = true;
    setTimeout(() => {
      this.updateScheduled = false;
      this.notify();
    }, 50);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* swallow listener errors */
      }
    }
  }
}
