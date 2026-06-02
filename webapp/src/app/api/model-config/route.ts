// Per-model configuration (api_url etc.) stored in MongoDB.
//
// The webapp also reads the env var MODEL_SERVER_URL on the server so that
// the chat works out of the box without anyone having to call POST first.
// Database entries always take precedence over the env-derived defaults.
import { NextResponse } from 'next/server';
import { connectToMongoDB } from '@/app/lib/mongodb';

const COLLECTION = 'model_config';
const DEFAULT_MODEL_IDS = ['astromind-multi-agent', 'astromind-openai'];

function envDefaults() {
  const url = process.env.MODEL_SERVER_URL || '';
  return DEFAULT_MODEL_IDS.map((model_id) => ({
    model_id,
    api_url: url,
    last_updated: new Date(0).toISOString(),
    _source: 'env',
  }));
}

export async function GET() {
  try {
    const { db } = await connectToMongoDB();
    const stored = await db.collection(COLLECTION).find({}).toArray();

    // Index stored configs by model_id so we can layer env defaults underneath.
    const byModel = new Map(stored.map((d: any) => [d.model_id, d]));
    const merged = envDefaults().map((d) =>
      byModel.has(d.model_id) ? { ...d, ...byModel.get(d.model_id), _source: 'db' } : d,
    );
    // Include any DB-only entries (model_ids we don't know about by default).
    for (const d of stored) {
      if (!DEFAULT_MODEL_IDS.includes(d.model_id as string)) {
        merged.push({ ...d, _source: 'db' });
      }
    }

    return NextResponse.json({ success: true, modelConfigs: merged });
  } catch (error) {
    console.error('Error fetching model configurations:', error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const { modelId, apiUrl } = await request.json();

    if (!modelId || typeof apiUrl !== 'string') {
      return NextResponse.json(
        { success: false, message: 'Model ID and API URL are required' },
        { status: 400 },
      );
    }

    const { db } = await connectToMongoDB();
    const result = await db.collection(COLLECTION).updateOne(
      { model_id: modelId },
      {
        $set: {
          model_id: modelId,
          api_url: apiUrl,
          last_updated: new Date(),
        },
      },
      { upsert: true },
    );

    return NextResponse.json({
      success: true,
      message: result.upsertedCount > 0 ? 'Model configuration created' : 'Model configuration updated',
      modelId,
      apiUrl,
    });
  } catch (error) {
    console.error('Error saving model configuration:', error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 },
    );
  }
}
