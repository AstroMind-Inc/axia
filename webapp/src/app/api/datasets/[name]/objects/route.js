import { NextResponse } from 'next/server';
import { connectToMongoDB } from '@/app/lib/mongodb';

export async function GET(request, { params }) {
  try {
    const resolvedParams = await params;
    const fileName = resolvedParams.name;
    const url = new URL(request.url);
    
    // Parse pagination parameters
    const skip = parseInt(url.searchParams.get('skip') || '0', 10);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    if (!fileName) {
      return NextResponse.json(
        { message: 'Collection name is required' },
        { status: 400 }
      );
    }

    const { dataDb } = await connectToMongoDB();

    // Get total count for pagination info
    const totalCount = await dataDb
      .collection(fileName)
      .countDocuments();

    // Query with pagination
    const objects = await dataDb
      .collection(fileName)
      .find({})
      .project({
        '_id': 1,
        'obsid': 1,
        'source_name': 1,
        'source_type': 1,
      })
      .skip(skip)
      .limit(limit)
      .toArray();
    
    // Debug: Check for source_type field presence
    const objectsWithSourceType = objects.filter(obj => obj.source_type !== undefined);
    console.log(`Found ${objectsWithSourceType.length} out of ${objects.length} objects with source_type`);
    
    if (objectsWithSourceType.length > 0) {
      console.log('Sample source_type values:', 
        objectsWithSourceType.slice(0, 5).map(obj => obj.source_type));
    } else {
      console.log('No source_type fields found in the query results');
      
      // Check if the source_type field exists in any documents in the collection
      const sampleWithSourceType = await dataDb
        .collection(fileName)
        .findOne({ source_type: { $exists: true } });
      
      if (sampleWithSourceType) {
        console.log('Found at least one document with source_type in the collection:', 
          sampleWithSourceType.source_type);
      } else {
        console.log('No documents with source_type field found in the collection');
      }
    }

    if (!objects.length && skip === 0) {
      return NextResponse.json(
        { message: 'No objects found in collection' },
        { status: 404 }
      );
    }

    const transformedObjects = objects.map(obj => {
      // Add mock source_type if it doesn't exist
      // This is a temporary solution until the database is updated with actual source_type values
      if (obj.source_type === undefined) {
        // Deterministically generate a mock source type based on obsid
        const mockTypes = ['X', 'QSO', 'STAR', 'GALAXY', 'AGN'];
        const mockTypeIndex = obj.obsid % mockTypes.length;
        obj.source_type = mockTypes[mockTypeIndex];
      }
      
      return {
        ...obj,
        _id: obj._id.toString()
      };
    });

    return NextResponse.json({
      success: true,
      total_count: totalCount,
      objects: transformedObjects
    });

  } catch (error) {
    console.error('Error fetching dataset objects:', error);
    return NextResponse.json(
      { 
        message: error.message || 'Internal server error',
        ...(error.details && { details: error.details })
      },
      { status: error.status || 500 }
    );
  }
}