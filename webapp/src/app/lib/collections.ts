import { METADATA_COLLECTION, SOURCES_COLLECTION } from "@/app/lib/collection-names";

// App-internal collections. They hold per-user or deployment-wide state and
// must never be readable through the dataset-by-name routes.
export const SYSTEM_COLLECTIONS = new Set([
  "chat_threads",
  "chat_messages",
  "chat_message_feedbacks",
  "user_settings",
  "user_uploaded_sources",
  "model_config",
  "metadata_records",
  METADATA_COLLECTION,
]);

export function isPublicCorpus(collectionName: string): boolean {
  return collectionName === SOURCES_COLLECTION;
}

export function isSystemCollection(collectionName: string): boolean {
  return SYSTEM_COLLECTIONS.has(collectionName);
}
