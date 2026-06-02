import { NextResponse } from 'next/server';
import { connectToMongoDB } from '@/app/lib/mongodb';

export async function GET() {
  try {
    const { appDb } = await connectToMongoDB();
    const result = await appDb.collection('source_data')
      .findOne({'key': 'source_fields'}, {
        projection: { 'value': 1, '_id': 0 }
      });

    if (!result) {
      return NextResponse.json(
        { success: false, message: 'Source fields not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(result.value);
  } catch (error) {
    console.error('Error fetching source fields data:', error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
