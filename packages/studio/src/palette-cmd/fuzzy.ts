/**
 * Small fuzzy matcher for the command palette: query letters must appear in order; matches at
 * word starts, consecutive runs and the very beginning score higher; gaps cost a little.
 * Returns the matched character positions so the row can highlight them.
 */

const isBoundary = (text: string, i: number) => {
  if (i === 0) return true;
  const prev = text[i - 1]!;
  const c = text[i]!;
  return !/[\p{L}\p{N}]/u.test(prev) || (/\p{Ll}/u.test(prev) && /\p{Lu}/u.test(c));
};

export function fuzzy(query: string, text: string): { score: number; hits: number[] } | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return { score: 0, hits: [] };
  const direct = t.indexOf(q);
  if (direct >= 0) {
    // Substring: best case, bonus when it starts a word or the text.
    const hits = Array.from({ length: q.length }, (_, k) => direct + k);
    const score = 40 + q.length * 6 + (direct === 0 ? 30 : isBoundary(text, direct) ? 18 : 0) + (t.length === q.length ? 25 : 0) - direct * 0.2;
    return { score, hits };
  }
  const hits: number[] = [];
  let score = 0;
  let from = 0;
  for (let k = 0; k < q.length; k++) {
    const ch = q[k]!;
    if (ch === " ") continue;
    let at = t.indexOf(ch, from);
    if (at < 0) return null;
    // Prefer a word start ahead when this one would not continue a run.
    if (!(hits.length && at === hits[hits.length - 1]! + 1) && !isBoundary(text, at)) {
      for (let j = at + 1; j < t.length; j++)
        if (t[j] === ch && isBoundary(text, j)) {
          at = j;
          break;
        }
    }
    const consecutive = hits.length > 0 && at === hits[hits.length - 1]! + 1;
    score += 1 + (isBoundary(text, at) ? 8 : 0) + (consecutive ? 6 : 0) + (at === 0 ? 8 : 0);
    score -= Math.min(6, (at - from) * 0.15);
    hits.push(at);
    from = at + 1;
  }
  // Letters scattered across unrelated words aren't a match.
  if (score < q.replace(/\s/g, "").length * 3) return null;
  return { score, hits };
}

/**
 * Score a command: every word of the query must match the title, or else its keywords / group /
 * hint (those count less and highlight nothing).
 */
export function scoreCommand(query: string, title: string, extra: string): { score: number; hits: number[] } | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { score: 0, hits: [] };
  // The whole query against the title first (keeps "snap grid" → "Snap to grid" highlighting together).
  const whole = fuzzy(query.trim(), title);
  let total = 0;
  const hits = new Set<number>();
  for (const w of words) {
    const inTitle = fuzzy(w, title);
    // Keywords match as plain substrings (fuzzy across a keyword list finds nonsense).
    const at = extra.toLowerCase().indexOf(w.toLowerCase());
    const inExtra = at >= 0 ? { score: 30 + w.length * 4 + (isBoundary(extra, at) ? 12 : 0), hits: [] } : null;
    const tScore = inTitle ? inTitle.score : -Infinity;
    const eScore = inExtra ? inExtra.score * 0.55 : -Infinity;
    if (tScore === -Infinity && eScore === -Infinity) return null;
    if (tScore >= eScore) {
      total += tScore;
      inTitle!.hits.forEach((h) => hits.add(h));
    } else total += eScore;
  }
  if (whole && whole.score > total) return { score: whole.score + 4, hits: whole.hits };
  return { score: total, hits: [...hits].sort((a, b) => a - b) };
}
