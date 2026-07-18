/**
 * Explicit story follows — entity-keyed, local-first (guests included).
 * A "follow" stores an article/thread's key entities; followed entities
 * hard-boost ranking and seed the catch-up delta.
 */

const KEY = "nm_follows_v1";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function normEntity(e: string): string {
  return e.toLowerCase().trim();
}

export function getFollows(): string[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function write(list: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 100))); } catch { /* ignore */ }
}

/** Is any of these entities followed? */
export function isFollowed(entities: string[] | null | undefined): boolean {
  if (!entities?.length) return false;
  const set = new Set(getFollows());
  return entities.some((e) => set.has(normEntity(e)));
}

/** Toggle follow on a set of entities. Returns the new state (true = following). */
export function toggleFollow(entities: string[] | null | undefined): boolean {
  if (!entities?.length || !isBrowser()) return false;
  const keys = entities.map(normEntity).filter((k) => k.length >= 3);
  if (!keys.length) return false;
  const cur = getFollows();
  const set = new Set(cur);
  const following = keys.some((k) => set.has(k));
  if (following) {
    write(cur.filter((k) => !keys.includes(k)));
    return false;
  }
  write([...keys.filter((k) => !set.has(k)), ...cur]);
  return true;
}
