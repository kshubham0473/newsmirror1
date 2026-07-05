/**
 * Topic affinity — the engine behind personalized feed ordering.
 *
 * Local-first: signals accumulate in localStorage with a 7-day half-life,
 * so the algorithm works for guests and signed-in users alike.
 * Signal weights (agreed in design discussion):
 *   thumbs-up +4 · open +3 · flip +2 · long-dwell +1 · thumbs-down −3
 */

const KEY = "nm_affinity_v1";
const HALF_LIFE_MS = 7 * 24 * 3600 * 1000;

export const SIGNAL = {
  reactUp: 4,
  open: 3,
  flip: 2,
  dwell: 1,
  reactDown: -3,
} as const;

interface Store {
  updated: number;
  scores: Record<string, number>;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function load(): Store {
  if (!isBrowser()) return { updated: Date.now(), scores: {} };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { updated: Date.now(), scores: {} };
    const store = JSON.parse(raw) as Store;
    // Apply exponential decay for the time elapsed since last write
    const elapsed = Date.now() - (store.updated ?? Date.now());
    if (elapsed > 60_000) {
      const factor = Math.pow(0.5, elapsed / HALF_LIFE_MS);
      for (const k of Object.keys(store.scores)) {
        store.scores[k] *= factor;
        if (Math.abs(store.scores[k]) < 0.05) delete store.scores[k];
      }
      store.updated = Date.now();
    }
    return store;
  } catch {
    return { updated: Date.now(), scores: {} };
  }
}

function save(store: Store) {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch { /* ignore */ }
}

/** Record an engagement signal against an article's topics. */
export function recordSignal(topics: string[] | null | undefined, weight: number) {
  if (!topics?.length || !isBrowser()) return;
  const store = load();
  for (const t of topics) {
    store.scores[t] = (store.scores[t] ?? 0) + weight;
  }
  store.updated = Date.now();
  save(store);
}

/** Current decayed affinity map: topic → score (may be negative). */
export function getAffinity(): Record<string, number> {
  return load().scores;
}

/** The reader's top-N topics by affinity (positive scores only). */
export function topTopics(n = 3): string[] {
  return Object.entries(load().scores)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}
