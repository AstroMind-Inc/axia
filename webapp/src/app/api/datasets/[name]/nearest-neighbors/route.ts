import { NextRequest, NextResponse } from 'next/server';
import { connectToMongoDB, MONGODB_MODE } from '@/app/lib/mongodb';
import { cosine, createTopK } from '@/app/lib/vector-search';

interface RouteParams {
  params: Promise<{ name: string }>;
}

const PROJECTION = {
  _id: 1,
  obsid: 1,
  source_name: 1,
  source_type: 1,
  source_type_category: 1,
  umap_2d: 1,
  pca_64d: 1,
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
  powlaw_nh: 1,
  apec_nh: 1,
  bb_nh: 1,
  brems_kt: 1,
  recommended_model: 1,
  event_list: 1,
};

// Only what scoring needs. The full PROJECTION carries event_list, which is
// ~72% of the payload and plays no part in similarity — fetching it for every
// source in the collection moved ~360MB per request. The winners are re-read
// with the full projection once they are known.
const SCAN_PROJECTION = {
  _id: 1,
  pca_64d: 1,
};

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const resolvedParams = await params;
    const { searchParams } = new URL(request.url);
    const objectId = searchParams.get('objectId');

    if (!objectId) {
      return NextResponse.json({ error: 'Object ID is required' }, { status: 400 });
    }

    const fileName = resolvedParams.name;
    const { db } = await connectToMongoDB();
    const coll = db.collection(fileName);

    let selectedObject: any = null;
    // 1) ObjectId lookup
    try {
      const { ObjectId } = await import('mongodb');
      selectedObject = await coll.findOne(
        { _id: new ObjectId(objectId) },
        { projection: { pca_64d: 1 } },
      );
    } catch {
      /* string id passed; try fallback below */
    }
    // 2) String-id fallback (axia samples store _id as a string)
    if (!selectedObject) {
      selectedObject = await coll.findOne(
        { _id: objectId as any },
        { projection: { pca_64d: 1 } },
      );
    }

    if (!selectedObject?.pca_64d) {
      return NextResponse.json(
        { error: 'Object not found or missing pca_64d vector' },
        { status: 404 },
      );
    }

    const queryVector: number[] = selectedObject.pca_64d;
    if (!Array.isArray(queryVector) || queryVector.length === 0) {
      return NextResponse.json({ error: 'Invalid pca_64d vector format' }, { status: 400 });
    }

    if (MONGODB_MODE === 'external') {
      const pipeline = [
        {
          $vectorSearch: {
            index: 'pca_64_vector_search',
            path: 'pca_64d',
            queryVector,
            numCandidates: 500,
            limit: 11,
          },
        },
        { $project: { ...PROJECTION, score: { $meta: 'vectorSearchScore' } } },
      ];
      const neighbors = await coll.aggregate(pipeline).toArray();
      const filtered = neighbors
        .filter((n) => n._id.toString() !== selectedObject._id.toString())
        .slice(0, 10);
      return NextResponse.json({ neighbors: filtered, totalFound: filtered.length });
    }

    // Local-mode brute force fallback. Scored with a minimal projection and a
    // bounded top-K, so neither the payload nor the memory grows with the
    // collection; only the winners are read in full.
    const LIMIT = 10;
    const cursor = coll.find({ pca_64d: { $exists: true } }, { projection: SCAN_PROJECTION });
    const top = createTopK<{ _id: any }>(LIMIT);
    for await (const doc of cursor) {
      if (doc._id.toString() === selectedObject._id.toString()) continue;
      const v = doc.pca_64d as number[] | undefined;
      if (!Array.isArray(v)) continue;
      top.add({ _id: doc._id }, cosine(queryVector, v));
    }

    const best = top.values();
    if (best.length === 0) {
      return NextResponse.json({ neighbors: [], totalFound: 0 });
    }
    const hydrated = await coll
      .find({ _id: { $in: best.map((b) => b._id) } }, { projection: PROJECTION })
      .toArray();
    const byId = new Map(hydrated.map((d) => [String(d._id), d]));
    const filtered = best
      .map((b) => {
        const doc = byId.get(String(b._id));
        return doc ? { ...doc, score: b.score } : null;
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);
    return NextResponse.json({ neighbors: filtered, totalFound: filtered.length });
  } catch (error) {
    console.error('Error finding nearest neighbors:', error);
    return NextResponse.json({ error: 'Failed to find nearest neighbors' }, { status: 500 });
  }
}
