// MongoDB client wrapper for the webapp.
//
// The whole app speaks to a single configured database with TWO collections:
// a merged per-source corpus (default name `sources`) and a small dataset
// registry (`metadata_records`). The corpus document carries both the pruned
// `event_list` (model input) and the unpruned `original_event_list`
// (spectrum-snapshot input) on every record, plus `ra`/`dec`, `pca_64d`,
// `umap_2d`, and all CSC catalog fields.
//
// When MONGODB_MODE=local (compose) we use community MongoDB; vector search
// is unavailable, so /api/nearest-neighbors falls back to brute-force cosine
// similarity in Node. When MONGODB_MODE=external (Atlas) the same code path
// uses $vectorSearch.

import { MongoClient, Db } from 'mongodb';
import dns from 'dns';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

// Server-side (Node) routes use MONGODB_URI when set so they can reach Mongo
// over the docker network. NEXT_PUBLIC_MONGODB_URI is only here for any
// (rare) client-side usage and as a final fallback.
const MONGODB_URI =
  process.env.MONGODB_URI ||
  process.env.NEXT_PUBLIC_MONGODB_URI ||
  'mongodb://localhost:27017';

const MONGODB_DB =
  process.env.MONGODB_DB || process.env.NEXT_PUBLIC_MONGODB_DB || 'axia';

export const MONGODB_MODE: 'local' | 'external' =
  (process.env.NEXT_PUBLIC_MONGODB_MODE || process.env.MONGODB_MODE || 'local') === 'external'
    ? 'external'
    : 'local';

// Name of the merged per-source corpus collection. Read from either of two
// env var names so older deployments that still set MONGODB_SOURCES_COLLECTION
// keep working transparently.
export const SOURCES_COLLECTION =
  process.env.MONGODB_CORPUS_COLLECTION ||
  process.env.MONGODB_SOURCES_COLLECTION ||
  'sources';
export const METADATA_COLLECTION =
  process.env.MONGODB_METADATA_COLLECTION || 'metadata_records';

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

const clientOptions = {
  serverSelectionTimeoutMS: 8000,
  maxPoolSize: 10,
};

if (!global._mongoClientPromise) {
  const client = new MongoClient(MONGODB_URI, clientOptions as any);
  global._mongoClientPromise = client.connect();
}

const clientPromise: Promise<MongoClient> = global._mongoClientPromise as Promise<MongoClient>;

export interface AxiaDbHandles {
  db: Db;
  sources: ReturnType<Db['collection']>;
  metadata: ReturnType<Db['collection']>;
  // back-compat aliases for older route handlers
  dataDb: Db;
  metaDb: Db;
  appDb: Db;
}

export async function connectToMongoDB(): Promise<AxiaDbHandles> {
  const client = await clientPromise;
  const db = client.db(MONGODB_DB);
  return {
    db,
    sources: db.collection(SOURCES_COLLECTION),
    metadata: db.collection(METADATA_COLLECTION),
    // Legacy aliases — all three point at the SAME single configured database.
    // Older routes that read `dataDb`/`metaDb`/`appDb` keep working.
    dataDb: db,
    metaDb: db,
    appDb: db,
  };
}

export async function closeMongoDBConnection() {
  const client = await clientPromise;
  await client.close();
}
