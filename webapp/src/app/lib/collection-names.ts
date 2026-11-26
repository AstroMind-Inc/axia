// Mongo collection names, resolved from the environment once.
//
// Kept free of side effects (no client, no connection) so that pure helpers
// such as lib/collections.ts and lib/authz.ts, and their unit tests, can share
// the same names as the data routes without opening a database connection.

// Name of the merged per-source corpus collection. Read from either of two
// env var names so older deployments that still set MONGODB_SOURCES_COLLECTION
// keep working transparently.
export const SOURCES_COLLECTION =
  process.env.MONGODB_CORPUS_COLLECTION ||
  process.env.MONGODB_SOURCES_COLLECTION ||
  'sources';

// Dataset registry: one record per uploaded JSON collection, owned via user_id.
export const METADATA_COLLECTION =
  process.env.MONGODB_METADATA_COLLECTION || 'metadata_records';
