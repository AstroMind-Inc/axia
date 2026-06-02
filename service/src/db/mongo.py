"""Thin MongoDB client wrapper for the service.

The whole service speaks to a single configured database with two
collections: a merged per-source corpus (default name `sources`) and a
small dataset registry (`metadata_records`).
"""

import logging
from typing import Any, Dict, List, Optional

from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.errors import ConnectionFailure, OperationFailure

from src.core.settings import get_settings

logger = logging.getLogger(__name__)


class MongoDBService:
    """Single-connection Mongo client."""

    def __init__(self) -> None:
        self._client: Optional[MongoClient] = None
        self._settings = get_settings()
        self._connect()

    def _connect(self) -> None:
        try:
            logger.info("Connecting to MongoDB ...")
            self._client = MongoClient(
                self._settings.mongodb_uri,
                maxPoolSize=50,
                minPoolSize=5,
                serverSelectionTimeoutMS=30000,
                connectTimeoutMS=30000,
                retryWrites=True,
                retryReads=True,
            )
            self._client.admin.command("ping")
            logger.info(
                "Connected to MongoDB (db=%s)", self._settings.mongodb_db
            )
        except ConnectionFailure as e:
            logger.error("MongoDB connection failed: %s", e)
            self._client = None
        except Exception as e:  # noqa: BLE001
            logger.error("Unexpected MongoDB connect error: %s", e)
            self._client = None

    # ------------------------------------------------------------------
    # Public helpers
    # ------------------------------------------------------------------

    def get_collection(
        self, collection_name: str, database_name: Optional[str] = None
    ) -> Optional[Collection]:
        """Return a collection handle, reconnecting if needed."""
        if self._client is None:
            self._connect()
        if self._client is None:
            return None
        db = database_name or self._settings.mongodb_db
        try:
            self._client.admin.command("ping")
            return self._client[db][collection_name]
        except ConnectionFailure:
            logger.warning("Mongo ping failed, reconnecting ...")
            self._connect()
            if self._client is None:
                return None
            return self._client[db][collection_name]

    # Convenience accessors using configured collection names ---------

    def corpus(self) -> Optional[Collection]:
        """The merged per-source corpus collection.

        Holds one doc per (obsid, source_name) with both `event_list`
        (pruned, model input) and `original_event_list` (unpruned, spectrum
        snapshot input), the `pca_64d` vector, `umap_2d`, ra/dec, and all
        catalog fields. See docs/07_dataset.md for the full schema.
        """
        return self.get_collection(self._settings.mongodb_corpus_collection)

    def metadata(self) -> Optional[Collection]:
        return self.get_collection(self._settings.mongodb_metadata_collection)

    # CRUD helpers ----------------------------------------------------

    def find_one(
        self, collection_name: str, filter_query: Optional[Dict] = None
    ) -> Optional[Dict]:
        coll = self.get_collection(collection_name)
        if coll is None:
            return None
        try:
            return coll.find_one(filter_query or {})
        except OperationFailure as e:
            logger.error("find_one failed: %s", e)
            return None

    def find_many(
        self,
        collection_name: str,
        filter_query: Optional[Dict] = None,
        limit: int = 0,
    ) -> List[Dict]:
        coll = self.get_collection(collection_name)
        if coll is None:
            return []
        try:
            cursor = coll.find(filter_query or {})
            if limit > 0:
                cursor = cursor.limit(limit)
            return list(cursor)
        except OperationFailure as e:
            logger.error("find_many failed: %s", e)
            return []

    def get_field_names(self, collection_name: str) -> List[str]:
        coll = self.get_collection(collection_name)
        if coll is None:
            return []
        try:
            doc = coll.find_one()
            if not doc:
                return []
            return sorted(k for k in doc.keys() if k != "_id")
        except Exception as e:  # noqa: BLE001
            logger.error("get_field_names failed: %s", e)
            return []

    def insert_one(
        self, collection_name: str, document: Dict[str, Any]
    ) -> Optional[str]:
        coll = self.get_collection(collection_name)
        if coll is None:
            return None
        try:
            result = coll.insert_one(document)
            return str(result.inserted_id)
        except OperationFailure as e:
            logger.error("insert_one failed: %s", e)
            return None

    def close(self) -> None:
        if self._client:
            self._client.close()
            self._client = None
            logger.info("Closed MongoDB connection")


_mongodb_service: Optional[MongoDBService] = None


def get_mongodb_service() -> MongoDBService:
    """Singleton accessor for the Mongo client."""
    global _mongodb_service
    if _mongodb_service is None:
        _mongodb_service = MongoDBService()
    return _mongodb_service
