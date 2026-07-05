/** Decode HTML entities that slip through RSS ingest (e.g. "farmers&apos;").
 *  Display-side safety net — the real fix lives in the ingest parser. */
const ENTITIES: Record<string, string> = {
  "&apos;": "'",
  "&#39;": "'",
  "&#039;": "'",
  "&quot;": '"',
  "&#34;": '"',
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
  "&ndash;": "–",
  "&mdash;": "—",
  "&hellip;": "…",
  "&rsquo;": "'",
  "&lsquo;": "'",
  "&rdquo;": "”",
  "&ldquo;": "“",
};

export function decodeEntities(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m] ?? m);
}
