import { NextRequest, NextResponse } from 'next/server';
import { connectToMongoDB, MONGODB_MODE, SOURCES_COLLECTION } from '@/app/lib/mongodb';
import { canAccessCollection, requireUserId } from '@/app/lib/authz';
import { excludeSelfNeighbors } from '@/app/lib/neighbors';

// Projection used by both the Atlas $vectorSearch and the local brute-force fallback.
const PROJECTION = {
  _id: 1,
  obsid: 1,
  source_name: 1,
  source_type: 1,
  source_type_category: 1,
  umap_2d: 1,
  pca_64d: 1,
  event_list: 1,
  hard_hs: 1,
  hard_hm: 1,
  hard_ms: 1,
  flux_significance_b: 1,
  var_index_b: 1,
  bb_kt: 1,
  powlaw_gamma: 1,
  powlaw_stat: 1,
  bb_stat: 1,
  brems_stat: 1,
  apec_stat: 1,
};

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0,
    na = 0,
    nb = 0;
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

export async function POST(request: NextRequest) {
  try {
    const authz = await requireUserId();
    if ('error' in authz) return authz.error;

    const body = await request.json();
    const {
      collection_name,
      vector,
      limit = 10,
      exclude_obsid,
      exclude_source_name,
      exclude_id,
    }: {
      collection_name?: string;
      vector: number[];
      limit?: number;
      exclude_obsid?: unknown;
      exclude_source_name?: unknown;
      exclude_id?: unknown;
    } = body;

    if (!Array.isArray(vector) || vector.length === 0) {
      return NextResponse.json(
        { error: 'non-empty `vector` is required' },
        { status: 400 },
      );
    }

    const { db } = await connectToMongoDB();
    const targetCollection = collection_name || SOURCES_COLLECTION;
    if (!(await canAccessCollection(db, targetCollection, authz.userId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const coll = db.collection(targetCollection);
    const k = Math.min(Number(limit) || 10, 50);

    if (MONGODB_MODE === 'external') {
      // Atlas $vectorSearch path (unchanged from production).
      const pipeline: any[] = [
        {
          $vectorSearch: {
            index: 'pca_64_vector_search',
            path: 'pca_64d',
            queryVector: vector,
            numCandidates: 500,
            limit: k + 1,
          },
        },
        {
          $project: { ...PROJECTION, score: { $meta: 'vectorSearchScore' } },
        },
      ];
      const neighbors = excludeSelfNeighbors(
        await coll.aggregate(pipeline).toArray(),
        { _id: exclude_id, obsid: exclude_obsid, source_name: exclude_source_name },
      ).slice(0, k);
      return NextResponse.json({ neighbors, totalFound: neighbors.length });
    }

    // Local-mode brute force fallback. With a few thousand docs this is sub-50ms.
    const cursor = coll.find({ pca_64d: { $exists: true } }, { projection: PROJECTION });
    const scored: any[] = [];
    for await (const doc of cursor) {
      const v = doc.pca_64d as number[] | undefined;
      if (!Array.isArray(v)) continue;
      scored.push({ ...doc, score: cosine(vector, v) });
    }
    scored.sort((a, b) => b.score - a.score);
    const neighbors = excludeSelfNeighbors(scored.slice(0, k + 1), {
      _id: exclude_id,
      obsid: exclude_obsid,
      source_name: exclude_source_name,
    }).slice(0, k);
    return NextResponse.json({ neighbors, totalFound: neighbors.length });
  } catch (error: any) {
    console.error('Error in nearest-neighbors:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to find nearest neighbors' },
      { status: 500 },
    );
  }
}
