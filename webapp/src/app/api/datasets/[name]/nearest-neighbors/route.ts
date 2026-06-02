import { NextRequest, NextResponse } from 'next/server';
import { connectToMongoDB, MONGODB_MODE } from '@/app/lib/mongodb';

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

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

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

    // Local-mode brute force fallback
    const cursor = coll.find({ pca_64d: { $exists: true } }, { projection: PROJECTION });
    const scored: any[] = [];
    for await (const doc of cursor) {
      if (doc._id.toString() === selectedObject._id.toString()) continue;
      const v = doc.pca_64d as number[] | undefined;
      if (!Array.isArray(v)) continue;
      scored.push({ ...doc, score: cosine(queryVector, v) });
    }
    scored.sort((a, b) => b.score - a.score);
    const filtered = scored.slice(0, 10);
    return NextResponse.json({ neighbors: filtered, totalFound: filtered.length });
  } catch (error) {
    console.error('Error finding nearest neighbors:', error);
    return NextResponse.json({ error: 'Failed to find nearest neighbors' }, { status: 500 });
  }
}
