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

/** Record an engagement signal against an article's topics and entities.
 *  Entities live in the same decayed store under an "e:" prefix — they power
 *  fine-grained interest (a saga, a club, a person) vs coarse topics. */
export function recordSignal(
  topics: string[] | null | undefined,
  weight: number,
  entities?: string[] | null
) {
  if (!isBrowser()) return;
  if (!topics?.length && !entities?.length) return;
  const store = load();
  for (const t of topics ?? []) {
    store.scores[t] = (store.scores[t] ?? 0) + weight;
  }
  for (const e of entities ?? []) {
    const k = "e:" + e.toLowerCase().trim();
    if (k.length < 5) continue;
    store.scores[k] = (store.scores[k] ?? 0) + weight;
  }
  store.updated = Date.now();
  save(store);
}

/** Max decayed affinity across an article's entities (0 if none). */
export function entityAffinity(
  entities: string[] | null | undefined,
  scores: Record<string, number>
): number {
  if (!entities?.length) return 0;
  return Math.max(0, ...entities.map((e) => scores["e:" + e.toLowerCase().trim()] ?? 0));
}

/** Current decayed affinity map: topic → score (may be negative). */
export function getAffinity(): Record<string, number> {
  return load().scores;
}

/** The reader's top-N topics by affinity (positive scores only). */
export function topTopics(n = 3): string[] {
  return Object.entries(load().scores)
    .filter(([k, v]) => v > 0 && !k.startsWith("e:"))
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}
