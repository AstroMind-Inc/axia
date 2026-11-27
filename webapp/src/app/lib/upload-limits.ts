// Per-user limits on stored uploads. Any Google account can sign in, and each
// upload creates a Mongo collection (or a large document) on the one EC2 disk,
// so without limits a single account can fill the disk or exhaust Mongo's
// file handles and take the app down for everyone.

/** Datasets a user may keep via /api/upload (one collection each). */
export const MAX_DATASETS_PER_USER = 50;

/** Uploaded-source sets a user may keep via /api/uploaded-sources. */
export const MAX_UPLOADED_SOURCE_SETS_PER_USER = 50;

/** Objects in one /api/upload dataset. */
export const MAX_OBJECTS_PER_DATASET = 10_000;

/** Objects in one /api/uploaded-sources set. Each may need an embedding call. */
export const MAX_OBJECTS_PER_SOURCE_SET = 1_000;

/** Dataset names and prefixes are user-facing labels, not documents. */
export const MAX_NAME_LENGTH = 100;
