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

    // Get search parameters
    const searchTerm = url.searchParams.get('search') || '';
    const sourceType = url.searchParams.get('sourceType') || '';

    // Sanitize search term
    const cleanSearchTerm = searchTerm.trim();

    if (!fileName) {
      return NextResponse.json(
        { message: 'Collection name is required' },
        { status: 400 }
      );
    }

    const { dataDb } = await connectToMongoDB();

    // Build search query
    let query = {};

    // Add search conditions if specified
    if (cleanSearchTerm) {
      console.log(`Processing search term: "${cleanSearchTerm}"`);
      query.$or = [];

      // Try to parse as number for obsid search
      const numericSearch = parseFloat(cleanSearchTerm);
      if (!isNaN(numericSearch)) {
        console.log(`Adding numeric search for obsid: ${numericSearch}`);
        // Exact match if it's a complete obsid
        query.$or.push({ obsid: numericSearch });

        // Also search for obsid as string prefix
        // (allows partial matching like "123" matching obsid 12345)
        query.$or.push({
          obsid: {
            $regex: `^${cleanSearchTerm}`
          }
        });
      }

      // Search in source_name (partial match)
      console.log(`Adding text search for source_name: "${cleanSearchTerm}"`);
      query.$or.push({
        source_name: {
          $regex: cleanSearchTerm,
          $options: 'i'  // case-insensitive
        }
      });

      // Search in source_type (partial match)
      console.log(`Adding text search for source_type: "${cleanSearchTerm}"`);
      query.$or.push({
        source_type: {
          $regex: cleanSearchTerm,
          $options: 'i'  // case-insensitive
        }
      });
    }

    // Add source_type filter if specified
    if (sourceType) {
      console.log(`Adding source_type filter: "${sourceType}"`);

      if (query.$or) {
        // If we already have search conditions, combine with AND
        query = {
          $and: [
            { source_type: sourceType },
            { $or: query.$or }
          ]
        };
      } else {
        // Simple filter if no search term
        query.source_type = sourceType;
      }
    }

    console.log('Final query:', JSON.stringify(query, null, 2));

    // Get total count for pagination info based on the search query
    const totalCount = await dataDb
      .collection(fileName)
      .countDocuments(query);  // Use our search query here

    console.log(`Found ${totalCount} total matches for query`);

    // Query with pagination and search filter
    const objects = await dataDb
      .collection(fileName)
      .find(query)  // Use our search query here
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
    } else if (objects.length > 0) {
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
      return NextResponse.json({
        success: true,
        total_count: 0,
        objects: [],
        message: searchTerm || sourceType ? 'No matching objects found' : 'No objects found in collection'
      });
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
      objects: transformedObjects,
      query: Object.keys(query).length > 0 ? query : null // Include query for debugging if not empty
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