// app/api/upload/route.ts
import { NextResponse } from 'next/server';
import { connectToMongoDB } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';

// Function to sanitize an object (replace NaN with null)
function sanitizeObject(obj: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Check if value is NaN
    if (typeof value === 'number' && isNaN(value)) {
      sanitized[key] = null;
    }
    // Check if value is an object (but not null and not an array)
    else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeObject(value);
    }
    // Check if value is an array
    else if (Array.isArray(value)) {
      sanitized[key] = value.map(item =>
        typeof item === 'object' && item !== null
          ? sanitizeObject(item)
          : (typeof item === 'number' && isNaN(item) ? null : item)
      );
    }
    // For all other values, keep as is
    else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// Validate data objects
function validateDataObject(obj: any, errorList: string[]): boolean {
  // Check required fields
  if (!obj.obsid) {
    errorList.push(`Object missing required field: obsid`);
    return false;
  }

  if (!obj.source_name) {
    errorList.push(`Object with obsid ${obj.obsid} missing required field: source_name`);
    return false;
  }

  // Check for either embedding or event_list
  if (!obj.embedding && !obj.event_list) {
    errorList.push(`Object with obsid ${obj.obsid} missing both embedding and event_list (at least one is required)`);
    return false;
  }

  // Validate embedding (if present)
  if (obj.embedding && (!Array.isArray(obj.embedding) || obj.embedding.length === 0)) {
    errorList.push(`Object with obsid ${obj.obsid} has invalid embedding (must be a non-empty array)`);
    return false;
  }

  // Validate event_list (if present)
  if (obj.event_list && (!Array.isArray(obj.event_list) || obj.event_list.length === 0)) {
    errorList.push(`Object with obsid ${obj.obsid} has invalid event_list (must be a non-empty array)`);
    return false;
  }

  // Check for NaN values
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'number' && isNaN(value)) {
      errorList.push(`Object with obsid ${obj.obsid} has NaN value for field "${key}". These will be replaced with null.`);
      // We don't return false here since we'll fix NaN values
    }
  }

  return true;
}

export async function POST(request: Request) {
  try {
    const { datasetName, dataObjects } = await request.json();

    // Validate request
    if (!datasetName || typeof datasetName !== 'string') {
      return NextResponse.json(
        { success: false, message: 'Dataset name is required' },
        { status: 400 }
      );
    }

    if (!dataObjects || !Array.isArray(dataObjects) || dataObjects.length === 0) {
      return NextResponse.json(
        { success: false, message: 'At least one data object is required' },
        { status: 400 }
      );
    }

    // Generate collection name (sanitized dataset name)
    const collectionName = `user_${datasetName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;

    // Validate each object
    const errors: string[] = [];
    const validObjects = dataObjects.filter(obj => validateDataObject(obj, errors));

    if (errors.length > 0 && validObjects.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: 'Validation errors found in data objects',
          errors
        },
        { status: 400 }
      );
    }

    // Sanitize objects (replace NaN with null)
    const sanitizedObjects = validObjects.map(obj => sanitizeObject(obj));

    // Connect to MongoDB
    const { dataDb, metaDb } = await connectToMongoDB();

    // Create a new collection and insert the objects
    await dataDb.createCollection(collectionName);
    const insertResult = await dataDb.collection(collectionName).insertMany(sanitizedObjects);

    // Create metadata record
    const metadataRecord = {
      file_name: datasetName,
      collection_name: collectionName,
      upload_date: new Date(),
      object_count: sanitizedObjects.length,
      upload_type: 'json',
      has_embeddings: sanitizedObjects.some(obj => obj.embedding),
      has_event_lists: sanitizedObjects.some(obj => obj.event_list)
    };

    const metaResult = await metaDb.collection('metadata_records').insertOne(metadataRecord);

    const successMessage = errors.length > 0
      ? `Successfully uploaded ${sanitizedObjects.length} objects to dataset "${datasetName}". Some objects had NaN values that were replaced with null.`
      : `Successfully uploaded ${sanitizedObjects.length} objects to dataset "${datasetName}"`;

    return NextResponse.json({
      success: true,
      message: successMessage,
      collection_name: collectionName,
      dataset_id: metaResult.insertedId.toString(),
      object_count: sanitizedObjects.length,
      warnings: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Error processing upload:', error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    );
  }
}