"""Service settings, loaded from environment variables.

All optional services (the fine-tuned model server, OpenAI API access) are
gracefully optional — the orchestrator detects which agents are wired up at
startup and disables the rest. Only MongoDB is strictly required.
"""

from functools import lru_cache
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # MongoDB ----------------------------------------------------------------
    mongodb_uri: str = Field(
        "mongodb://mongo:27017",
        description="MongoDB connection string (local container by default).",
    )
    mongodb_db: str = Field(
        "axia",
        description="MongoDB database name.",
    )
    mongodb_corpus_collection: str = Field(
        "sources",
        description=(
            "Collection holding the merged per-source corpus: event_list (pruned), "
            "original_event_list (unpruned), pca_64d, umap_2d, ra/dec, and all "
            "catalog fields. One collection per source — see docs/07_dataset.md."
        ),
    )
    mongodb_metadata_collection: str = Field(
        "metadata_records",
        description="Collection holding dataset registry entries.",
    )

    # Fine-tuned model server (OPTIONAL) -------------------------------------
    model_server_url: Optional[str] = Field(
        None,
        description="URL of the fine-tuned model server. If empty, Event Analyst is disabled.",
    )

    # CPU projector server (for embeddings without the LLM) -------------------
    projector_url: Optional[str] = Field(
        None,
        description=(
            "URL of the lightweight XrayProcessor + PCA/UMAP projector. "
            "Used for embedding generation (/project). Falls back to "
            "model_server_url if not set."
        ),
    )

    # OpenAI (used by the GPT-5 agents) --------------------------------------
    openai_api_key: Optional[str] = Field(
        None, description="OpenAI API key for GPT-5 agents."
    )
    openai_default_model: str = Field(
        "gpt-5-mini",
        description="Default OpenAI model used when the request doesn't specify one.",
    )

    # Service runtime --------------------------------------------------------
    service_host: str = Field("0.0.0.0")
    service_port: int = Field(8000)
    service_log_level: str = Field("info")
    service_debug: bool = Field(False)

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Convenience -----------------------------------------------------------
    @property
    def model_server_configured(self) -> bool:
        return bool(self.model_server_url and self.model_server_url.strip())

    @property
    def projector_configured(self) -> bool:
        return bool(self.projector_url and self.projector_url.strip())

    @property
    def embedding_url(self) -> str | None:
        """Best available URL for /project (projector preferred, model server as fallback)."""
        if self.projector_configured:
            return self.projector_url
        if self.model_server_configured:
            return self.model_server_url
        return None


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
