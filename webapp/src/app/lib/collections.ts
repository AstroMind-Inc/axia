export const SYSTEM_COLLECTIONS = new Set([
  "chat_threads",
  "chat_messages",
  "chat_message_feedbacks",
  "user_settings",
  "user_uploaded_sources",
  "metadata_records",
]);

export function publicCorpusName(): string {
  return (
    process.env.MONGODB_CORPUS_COLLECTION ||
    process.env.MONGODB_SOURCES_COLLECTION ||
    "sources"
  );
}

export function isPublicCorpus(collectionName: string): boolean {
  return collectionName === publicCorpusName();
}

export function isSystemCollection(collectionName: string): boolean {
  return SYSTEM_COLLECTIONS.has(collectionName);
}
