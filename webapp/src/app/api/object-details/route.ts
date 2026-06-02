// app/api/object-details/route.ts
import { NextResponse } from 'next/server';
import { connectToMongoDB } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';

// Helper function to check if a string is a valid ObjectId
function isValidObjectId(id: string): boolean {
  return /^[0-9a-fA-F]{24}$/.test(id);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { collection_name, object_id } = body;

    // Fixed condition to properly check for missing fields
    if (!collection_name || !object_id) {
      return NextResponse.json({ message: 'Missing required fields' }, { status: 400 });
    }

    const { dataDb, appDb } = await connectToMongoDB();

    let objectDetails = null;

    // 1) ObjectId lookup against the requested collection
    if (isValidObjectId(object_id)) {
      try {
        objectDetails = await dataDb.collection(collection_name).findOne({
          '_id': new ObjectId(object_id),
        });
      } catch (e) {
        console.log('ObjectId lookup failed, falling back to string-id lookup', e);
      }
    }

    // 2) String-id lookup against the requested collection (axia sample data
    //    stores _id as a string, as do user-uploaded sources)
    if (!objectDetails) {
      try {
        objectDetails = await dataDb
          .collection(collection_name)
          .findOne({ _id: object_id as any });
      } catch (e) {
        console.log('String-id lookup failed', e);
      }
    }

    // 3) Embedded lookup inside user_uploaded_sources
    if (!objectDetails) {
      try {
        const uploadedDataset = await appDb
          .collection('user_uploaded_sources')
          .findOne(
            { 'objects._id': object_id },
            { projection: { 'objects.$': 1 } },
          );
        if (uploadedDataset?.objects?.length) {
          objectDetails = uploadedDataset.objects[0];
        }
      } catch (e) {
        console.log('Uploaded-sources lookup failed', e);
      }
    }

    if (!objectDetails) {
      return NextResponse.json({ message: 'Object not found' }, { status: 404 });
    }

    return NextResponse.json(objectDetails);
  } catch (error) {
    console.error('Error fetching object details:', error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}