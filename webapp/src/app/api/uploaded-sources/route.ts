import { NextRequest, NextResponse } from 'next/server';
import { connectToMongoDB } from '@/app/lib/mongodb';

const COLLECTION_NAME = 'user_uploaded_sources';

// GET - Load all uploaded sources
export async function GET() {
  try {
    const { appDb } = await connectToMongoDB();
    const collection = appDb.collection(COLLECTION_NAME);

    // Find all uploaded datasets - but only project necessary fields for metadata
    // Don't load full embedded objects array immediately
    const uploadedDatasets = await collection
      .find({})
      .project({
        _id: 1,
        prefix: 1,
        uploadDate: 1,
        objectCount: 1,
        embeddingsGenerated: 1,
        createdAt: 1,
        updatedAt: 1
      })
      .toArray();
    
    // Use aggregation to efficiently extract all uploaded objects
    // User-uploaded data is typically small (hundreds, not thousands), so no pagination needed
    const objectsAggregation = await collection.aggregate([
      { $unwind: '$objects' },
      { $replaceRoot: { newRoot: '$objects' } }
    ]).toArray();

    const allObjects = objectsAggregation;
    const totalCount = uploadedDatasets.reduce((sum, ds) => sum + (ds.objectCount || 0), 0);

    console.log(`✅ Loaded ${allObjects.length} uploaded objects from ${uploadedDatasets.length} datasets`);

    return NextResponse.json({
      success: true,
      objects: allObjects,
      datasets: uploadedDatasets,
      total_count: totalCount
    });

  } catch (error) {
    console.error('Error loading uploaded sources:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to load uploaded sources' 
      },
      { status: 500 }
    );
  }
}

// POST - Save new uploaded data
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { objects, prefix, model_api_url, is_pruned } = body;

    if (!objects || !Array.isArray(objects) || !prefix) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid request body. Expected objects array and prefix.' 
        },
        { status: 400 }
      );
    }

    const { appDb } = await connectToMongoDB();
    const collection = appDb.collection(COLLECTION_NAME);

    // Check if prefix already exists
    const existingDataset = await collection.findOne({ prefix });
    
    if (existingDataset) {
      return NextResponse.json(
        { 
          success: false, 
          error: `A dataset with prefix "${prefix}" already exists. Please use a different prefix.` 
        },
        { status: 409 }
      );
    }

    // Process objects to generate missing embeddings
    console.log(`Processing ${objects.length} objects for missing embeddings...`);
    const processedObjects = [];
    let embeddingsGenerated = 0;
    const debugInfo = []; // Collect debug info to return to frontend

    const failedItems: Array<{ id: string; error: string }> = [];

    for (const obj of objects) {
      let processedObj = { ...obj };

      // Check if embeddings are missing and we have event_list data
      const needsEmbeddings = (!obj.umap_2d || !obj.pca_64d) && 
                             obj.event_list && 
                             Array.isArray(obj.event_list) && 
                             obj.event_list.length > 0;

      const objDebug: any = {
        objectId: obj._id || obj.obsid || 'unknown',
        hasUmap2d: !!obj.umap_2d,
        hasPca64d: !!obj.pca_64d,
        hasEventList: !!obj.event_list,
        eventListIsArray: Array.isArray(obj.event_list),
        eventListLength: obj.event_list ? obj.event_list.length : 0,
        needsEmbeddings: needsEmbeddings
      };

      debugInfo.push(objDebug);
      console.log(`🔍 Object ${objDebug.objectId}:`, objDebug);

      if (needsEmbeddings) {
        try {
          console.log(`🚀 Generating embeddings for object: ${obj._id || obj.obsid || 'unknown'}`);
          objDebug.embeddingStatus = 'attempting';
          
          // Call our embeddings API
          // Call internal API route (same origin) to forward to astromind-service
          const origin = request.nextUrl.origin;
          const embeddingsResponse = await fetch(`${origin}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // Mirror chat flow: pass model_api_url so backend uses exact same endpoint
            body: JSON.stringify({ 
              event_list: obj.event_list,
              model_api_url,
              is_pruned: !!is_pruned
            })
          });

          console.log(`📡 Embeddings API response status: ${embeddingsResponse.status}`);
          objDebug.apiResponseStatus = embeddingsResponse.status;

          if (embeddingsResponse.ok) {
            const embeddingsData = await embeddingsResponse.json();
            console.log(`📊 Embeddings data received:`, embeddingsData);
            objDebug.embeddingsReceived = embeddingsData;

            // Determine backend-reported errors or missing vectors
            const backendErrors = Array.isArray(embeddingsData.errors) ? embeddingsData.errors : [];
            const explicitError = embeddingsData.error as string | null;
            const hasPca = Array.isArray(embeddingsData.pca_64d) && embeddingsData.pca_64d.length > 0;
            const hasUmap = Array.isArray(embeddingsData.umap_2d) && embeddingsData.umap_2d.length === 2;
            // Backend provides a proper flag for insufficient window errors
            const isInsufficientWindow = embeddingsData.is_insufficient_window === true;

            if ((backendErrors && backendErrors.length > 0) || explicitError || !hasPca || !hasUmap) {
              const errMsg = explicitError || (backendErrors && backendErrors.length > 0 ? backendErrors.join('; ') : 'Missing vectors from model response');
              console.warn(`⚠️ Embeddings service reported failure for object ${obj._id || obj.obsid || 'unknown'}:`, errMsg);
              objDebug.embeddingStatus = 'validation_error';
              objDebug.error = errMsg;
              
              // Check backend flag for insufficient observation window (<8h)
              if (isInsufficientWindow) {
                // Allow upload without embeddings for short observations
                console.log(`ℹ️ Object has <8h observation window - saving without embeddings/pruning`);
                objDebug.embeddingStatus = 'skipped_short_window';
                objDebug.warning = 'Observation window <8h - embeddings not generated';
                // Move event_list to original_event_list, remove event_list
                processedObj.original_event_list = processedObj.event_list;
                delete processedObj.event_list;
                objDebug.eventListMovedToOriginal = true;
                // Don't add to failedItems, but note the warning
                // Object will be saved without pca_64d, umap_2d, and pruned event_list
              } else {
                // Other errors - add to failed items but still save the object
                failedItems.push({ id: obj._id || obj.obsid || 'unknown', error: errMsg });
                console.warn(`⚠️ Embeddings failed but object will be saved without embeddings`);
              }
            } else {
              // Add generated embeddings to the object
              processedObj.pca_64d = embeddingsData.pca_64d;
              objDebug.pca64dGenerated = true;
              processedObj.umap_2d = embeddingsData.umap_2d;
              objDebug.umap2dGenerated = true;
              // Replace event_list with pruned_event_list if provided; store original
              if (Array.isArray(embeddingsData.pruned_event_list)) {
                processedObj.original_event_list = processedObj.event_list;
                processedObj.event_list = embeddingsData.pruned_event_list;
                objDebug.eventListReplaced = true;
              }

              embeddingsGenerated++;
              objDebug.embeddingStatus = 'success';
              console.log(`✅ Generated embeddings for object: ${obj._id || obj.obsid || 'unknown'}`);
            }
          } else {
            const contentType = embeddingsResponse.headers.get('content-type') || '';
            let errorData: any = null;
            let concise = '';
            
            try {
              const errorText = await embeddingsResponse.text();
              if (contentType.includes('application/json')) {
                errorData = JSON.parse(errorText);
                concise = errorData.error || errorText;
              } else {
                concise = `Embeddings API ${embeddingsResponse.status}: ${embeddingsResponse.statusText}`;
              }
            } catch (e) {
              concise = `Embeddings API ${embeddingsResponse.status}: ${embeddingsResponse.statusText}`;
            }
            
            console.warn(`⚠️ Failed to generate embeddings for object ${obj._id || obj.obsid || 'unknown'}:`, concise);
            objDebug.embeddingStatus = 'api_error';
            objDebug.error = concise;
            
            // Check backend flag for insufficient observation window
            const isInsufficientWindow = errorData?.is_insufficient_window === true;
            
            if (isInsufficientWindow) {
              console.log(`ℹ️ Object has <8h observation window - saving without embeddings/pruning`);
              objDebug.embeddingStatus = 'skipped_short_window';
              objDebug.warning = 'Observation window <8h - embeddings not generated';
              // Move event_list to original_event_list, remove event_list
              processedObj.original_event_list = processedObj.event_list;
              delete processedObj.event_list;
              objDebug.eventListMovedToOriginal = true;
            } else {
              failedItems.push({ id: obj._id || obj.obsid || 'unknown', error: concise });
            }
            // Continue to save object without embeddings
          }
        } catch (error) {
          console.error(`❌ Error generating embeddings for object ${obj._id || obj.obsid || 'unknown'}:`, error);
          objDebug.embeddingStatus = 'exception';
          objDebug.error = error instanceof Error ? error.message : String(error);
          failedItems.push({ id: obj._id || obj.obsid || 'unknown', error: objDebug.error });
          // Continue to save object without embeddings
        }
      }

      processedObjects.push(processedObj);
    }

    console.log(`✅ Embeddings generation complete. Generated for ${embeddingsGenerated}/${objects.length} objects.`);

    // Create the dataset document with processed objects
    const datasetDocument = {
      prefix,
      objects: processedObjects,
      uploadDate: new Date(),
      objectCount: processedObjects.length,
      embeddingsGenerated,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Insert the new dataset
    const result = await collection.insertOne(datasetDocument);

    return NextResponse.json({
      success: true,
      insertedId: result.insertedId,
      prefix,
      objectCount: processedObjects.length,
      embeddingsGenerated,
      failedItems,
      debugInfo: debugInfo, // Include debug information for frontend
      message: `Successfully saved ${processedObjects.length} objects with prefix "${prefix}". Generated embeddings for ${embeddingsGenerated} objects.`
    });

  } catch (error) {
    console.error('Error saving uploaded sources:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to save uploaded sources' 
      },
      { status: 500 }
    );
  }
}

// DELETE - Remove uploaded dataset by prefix
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const prefix = searchParams.get('prefix');

    if (!prefix) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Prefix parameter is required' 
        },
        { status: 400 }
      );
    }

    const { appDb } = await connectToMongoDB();
    const collection = appDb.collection(COLLECTION_NAME);

    // Delete the dataset with the specified prefix
    const result = await collection.deleteOne({ prefix });

    if (result.deletedCount === 0) {
      return NextResponse.json(
        { 
          success: false, 
          error: `No dataset found with prefix "${prefix}"` 
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      deletedCount: result.deletedCount,
      message: `Successfully deleted dataset with prefix "${prefix}"`
    });

  } catch (error) {
    console.error('Error deleting uploaded sources:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to delete uploaded sources' 
      },
      { status: 500 }
    );
  }
}
