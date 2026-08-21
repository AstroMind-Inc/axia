export type NeighborIdentity = {
  obsid?: unknown;
  source_name?: unknown;
  _id?: unknown;
};

function sameId(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

/**
 * Drop the query source from a neighbour list. Matches on `_id` when both
 * sides have one, otherwise on `(obsid, source_name)`.
 */
export function excludeSelfNeighbors<T extends NeighborIdentity>(
  neighbors: T[],
  source?: NeighborIdentity | null,
): T[] {
  if (!source) return neighbors;
  return neighbors.filter((n) => {
    if (source._id != null && n._id != null && sameId(n._id, source._id)) {
      return false;
    }
    if (
      source.source_name != null &&
      n.source_name != null &&
      sameId(n.source_name, source.source_name) &&
      sameId(n.obsid, source.obsid)
    ) {
      return false;
    }
    return true;
  });
}
