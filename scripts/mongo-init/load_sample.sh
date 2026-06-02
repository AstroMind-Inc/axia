#!/usr/bin/env bash
# Seed the local Mongo container with the bundled sample dataset.
# Idempotent: if the corpus collection already has documents, this is a no-op
# unless RELOAD=1 is set.
set -euo pipefail

URI="${MONGODB_URI:-mongodb://mongo:27017}"
DB="${MONGODB_DB:-axia}"
COL_CORPUS="${MONGODB_CORPUS_COLLECTION:-sources}"
COL_META="${MONGODB_METADATA_COLLECTION:-metadata_records}"
RELOAD="${RELOAD:-0}"

echo "[mongo-init] target: $URI  db=$DB"

# Wait for Mongo to accept connections
for i in $(seq 1 60); do
    if mongosh --quiet "$URI" --eval "db.adminCommand('ping')" >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

count=$(mongosh --quiet "$URI/$DB" --eval "db.${COL_CORPUS}.countDocuments({})" 2>/dev/null || echo 0)
count=${count:-0}

if [[ "$RELOAD" != "1" ]] && [[ "$count" =~ ^[0-9]+$ ]] && (( count > 0 )); then
    echo "[mongo-init] $DB.$COL_CORPUS already has $count documents; skip (set RELOAD=1 to force)."
    exit 0
fi

if [[ "$RELOAD" == "1" ]]; then
    echo "[mongo-init] RELOAD=1 — dropping target collections."
    mongosh --quiet "$URI/$DB" --eval "
        db.${COL_CORPUS}.drop();
        db.${COL_META}.drop();
    " >/dev/null
fi

# Import the merged sample corpus (one doc per source, both event_lists, ra/dec, etc.)
if [[ -s "/seed/sample_corpus.json" ]]; then
    echo "[mongo-init] importing /seed/sample_corpus.json -> $DB.$COL_CORPUS"
    mongoimport --uri "$URI" --db "$DB" --collection "$COL_CORPUS" \
        --file "/seed/sample_corpus.json" --jsonArray --drop --quiet
else
    echo "[mongo-init] WARN: /seed/sample_corpus.json missing or empty"
fi

if [[ -s "/seed/sample_metadata_records.json" ]]; then
    echo "[mongo-init] importing /seed/sample_metadata_records.json -> $DB.$COL_META"
    mongoimport --uri "$URI" --db "$DB" --collection "$COL_META" \
        --file "/seed/sample_metadata_records.json" --jsonArray --drop --quiet
fi

# Indexes. Atlas vector search needs to be created via Atlas API (not here).
echo "[mongo-init] creating indexes"
mongosh --quiet "$URI/$DB" --eval "
    db.${COL_CORPUS}.createIndex({obsid: 1, source_name: 1});
    db.${COL_CORPUS}.createIndex({source_type_category: 1});
" >/dev/null

new_count=$(mongosh --quiet "$URI/$DB" --eval "db.${COL_CORPUS}.countDocuments({})")
echo "[mongo-init] $DB.$COL_CORPUS now has $new_count documents."
