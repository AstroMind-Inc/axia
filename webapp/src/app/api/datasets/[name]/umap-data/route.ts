import { NextRequest, NextResponse } from 'next/server';
import { connectToMongoDB } from '@/app/lib/mongodb';

interface RouteParams {
  params: Promise<{
    name: string;
  }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const resolvedParams = await params;
    const fileName = resolvedParams.name;
    const url = new URL(request.url);
    const includeObjectId = url.searchParams.get('includeObject');

    if (!fileName) {
      return NextResponse.json(
        { message: 'Collection name is required' },
        { status: 400 }
      );
    }

    const { dataDb } = await connectToMongoDB();

    // Build the projection with all the new fields
    const projection = {
      '_id': 1,
      'umap_2d': 1,
      'obsid': 1,
      'source_name': 1,
      // Hardness ratios
      'hard_hs': 1,
      'hard_hm': 1,
      'hard_ms': 1,
      // Numerical features
      'flux_significance_b': 1,
      'var_index_b': 1,
      'bb_kt': 1,
      'powlaw_gamma': 1,
      'powlaw_stat': 1,
      'bb_stat': 1,
      'brems_stat': 1,
      'apec_stat': 1,
      'powlaw_nh': 1,
      'apec_nh': 1,
      'bb_nh': 1,
      'brems_kt': 1,
      // Categorical features
      'source_type': 1,
      'source_type_category': 1,
      'recommended_model': 1
    };

    // Query for up to 5000 objects with UMAP data
    // Only include objects that have umap_2d field
    const umapObjects = await dataDb
      .collection(fileName)
      .find({ 
        umap_2d: { $exists: true, $ne: null, $size: 2 }
      })
      .project(projection)
      .limit(5000)
      .toArray();

    // If a specific object is requested and not in the results, fetch it separately
    let specificObject = null;
    if (includeObjectId) {
      const objectExists = umapObjects.some(obj => obj._id.toString() === includeObjectId);
      if (!objectExists) {
        // Try to find the object using string comparison first
        specificObject = await dataDb
          .collection(fileName)
          .findOne(
            {
              _id: includeObjectId as any,
              umap_2d: { $exists: true, $ne: null, $size: 2 }
            },
            { projection }
          );
        
        // If not found with string ID, try with ObjectId
        if (!specificObject) {
          try {
            const { ObjectId } = await import('mongodb');
            specificObject = await dataDb
              .collection(fileName)
              .findOne(
                { 
                  _id: new ObjectId(includeObjectId),
                  umap_2d: { $exists: true, $ne: null, $size: 2 }
                },
                { projection }
              );
          } catch (error) {
            console.log('ObjectId conversion failed, using string ID only');
          }
        }
      }
    }

    console.log(`Found ${umapObjects.length} objects with UMAP data in collection ${fileName}`);
    
    // Filter out any objects with invalid UMAP coordinates
    const validUmapObjects = umapObjects.filter(obj => 
      obj.umap_2d && 
      Array.isArray(obj.umap_2d) && 
      obj.umap_2d.length === 2 &&
      typeof obj.umap_2d[0] === 'number' &&
      typeof obj.umap_2d[1] === 'number' &&
      !isNaN(obj.umap_2d[0]) &&
      !isNaN(obj.umap_2d[1])
    );

    // Add the specific object if it exists and has valid coordinates
    if (specificObject && 
        specificObject.umap_2d && 
        Array.isArray(specificObject.umap_2d) && 
        specificObject.umap_2d.length === 2 &&
        typeof specificObject.umap_2d[0] === 'number' &&
        typeof specificObject.umap_2d[1] === 'number' &&
        !isNaN(specificObject.umap_2d[0]) &&
        !isNaN(specificObject.umap_2d[1])) {
      validUmapObjects.push(specificObject);
    }

    console.log(`${validUmapObjects.length} objects have valid UMAP coordinates`);
    if (specificObject) {
      console.log(`Included specific object with ID: ${includeObjectId}`);
    }

    return NextResponse.json({
      objects: validUmapObjects,
      total_count: validUmapObjects.length,
      selectedObjectIncluded: !!specificObject
    });

  } catch (error) {
    console.error('Error fetching UMAP data:', error);
    return NextResponse.json(
      { 
        message: 'Failed to fetch UMAP data',
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}