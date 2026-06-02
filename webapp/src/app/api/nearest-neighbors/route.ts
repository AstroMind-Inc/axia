import { NextRequest, NextResponse } from 'next/server';
import { connectToMongoDB, MONGODB_MODE, SOURCES_COLLECTION } from '@/app/lib/mongodb';

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
    const body = await request.json();
    const {
      collection_name,
      vector,
      limit = 10,
    }: { collection_name?: string; vector: number[]; limit?: number } = body;

    if (!Array.isArray(vector) || vector.length === 0) {
      return NextResponse.json(
        { error: 'non-empty `vector` is required' },
        { status: 400 },
      );
    }

    const { db } = await connectToMongoDB();
    // Honour an explicit `collection_name` when provided (used by some routes
    // that hold legacy dataset names), otherwise fall back to the configured
    // sources collection.
    const coll = db.collection(collection_name || SOURCES_COLLECTION);
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
            limit: k,
          },
        },
        {
          $project: { ...PROJECTION, score: { $meta: 'vectorSearchScore' } },
        },
      ];
      const neighbors = await coll.aggregate(pipeline).toArray();
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
    const neighbors = scored.slice(0, k);
    return NextResponse.json({ neighbors, totalFound: neighbors.length });
  } catch (error: any) {
    console.error('Error in nearest-neighbors:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to find nearest neighbors' },
      { status: 500 },
    );
  }
}
