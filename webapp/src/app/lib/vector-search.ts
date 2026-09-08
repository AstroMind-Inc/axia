/**
 * Helpers for the local-mode brute-force nearest-neighbour scan.
 *
 * Atlas Vector Search is unavailable in community-edition Mongo, so local
 * deployments score every source in the collection by hand. On the full 51k
 * corpus that scan is the single most expensive thing the webapp does, so it
 * is worth keeping tight.
 */

/**
 * Cosine similarity between two vectors, compared over their shared prefix.
 * Returns 0 when either side has no magnitude.
 */
export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/**
 * Collects the `k` highest-scoring items from a stream, dropping the rest as
 * it goes.
 *
 * The scan used to push all ~51k scored documents into an array and sort it,
 * which meant holding the whole corpus in memory to return ten rows. This
 * keeps at most `k` items however many are offered, so memory is bounded by
 * the result size rather than the collection size.
 *
 * Equal scores keep the earlier-seen item, matching the stable sort this
 * replaces.
 */
export function createTopK<T>(k: number) {
  const items: Array<T & { score: number }> = [];
  return {
    add(item: T, score: number): void {
      // Once full, anything not beating the weakest entry is discarded
      // outright — the common case on a large scan.
      if (items.length >= k && score <= items[items.length - 1].score) return;
      let lo = 0;
      let hi = items.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (items[mid].score >= score) lo = mid + 1;
        else hi = mid;
      }
      items.splice(lo, 0, { ...item, score });
      if (items.length > k) items.pop();
    },
    values(): Array<T & { score: number }> {
      return items;
    },
  };
}
