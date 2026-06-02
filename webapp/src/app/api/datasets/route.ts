// Lists available datasets (= sources collections). In axia we ship a single
// configured `sources` collection by default; older multi-collection layouts
// stored in `metadata_records` are still listed if they exist.
import { NextResponse } from 'next/server';
import {
  connectToMongoDB,
  SOURCES_COLLECTION,
  METADATA_COLLECTION,
} from '@/app/lib/mongodb';

export async function GET() {
  try {
    const { db } = await connectToMongoDB();

    // Always advertise the configured sources collection.
    const sourcesCount = await db
      .collection(SOURCES_COLLECTION)
      .estimatedDocumentCount()
      .catch(() => 0);

    type Dataset = {
      _id: string;
      file_name?: string;
      collection_name?: string;
      upload_date?: unknown;
      object_count?: number;
    };

    const datasets: Dataset[] = [
      {
        _id: SOURCES_COLLECTION,
        file_name: 'Axia sources',
        collection_name: SOURCES_COLLECTION,
        object_count: sourcesCount,
      },
    ];

    // Also list any other collections registered in metadata_records.
    try {
      const extra = await db
        .collection(METADATA_COLLECTION)
        .find({})
        .project({
          _id: 1,
          file_name: 1,
          collection_name: 1,
          upload_date: 1,
          object_count: 1,
        })
        .toArray();

      for (const raw of extra) {
        if (!raw.collection_name || raw.collection_name === SOURCES_COLLECTION) {
          continue;
        }
        datasets.push({ ...raw, _id: String(raw._id) } as Dataset);
      }
    } catch {
      // metadata_records may be absent on a fresh stack — fine.
    }

    return NextResponse.json({ success: true, datasets });
  } catch (error) {
    console.error('Error fetching datasets:', error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
