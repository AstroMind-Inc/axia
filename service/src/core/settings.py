"""Service settings, loaded from environment variables.

All optional services (the fine-tuned model server, OpenAI API access) are
gracefully optional — the orchestrator detects which agents are wired up at
startup and disables the rest. Only MongoDB is strictly required.
"""

from functools import lru_cache
from typing import Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from src.llm.models import DEFAULT_MODEL, SUPPORTED_MODELS


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

    model_server_token: Optional[str] = Field(
        None,
        description=(
            "Shared secret sent as a bearer token to the model server and the "
            "projector. Set the same value as MODEL_SERVER_TOKEN on the model "
            "server so it rejects anyone else."
        ),
    )
    allow_custom_model_url: bool = Field(
        False,
        description=(
            "Honour a client-supplied model_api_url. Off by default: on a shared "
            "deployment it lets any caller make the service send requests anywhere."
        ),
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
        DEFAULT_MODEL,
        description="Default OpenAI model used when the request doesn't specify one.",
    )

    @field_validator("openai_default_model")
    @classmethod
    def _warn_on_unknown_model(cls, v: str) -> str:
        """Warn loudly about a stale OPENAI_DEFAULT_MODEL rather than failing.

        Retired ids (gpt-5-mini, gpt-4o, o3-mini, ...) are rejected by the API
        at request time with an error that does not obviously point back at
        this setting. The value is still passed through, since a deployment
        may legitimately use a model this build has not heard of.
        """
        if v and v not in SUPPORTED_MODELS:
            import warnings

            warnings.warn(
                f"OPENAI_DEFAULT_MODEL={v!r} is not a model this build knows about "
                f"(expected one of {', '.join(SUPPORTED_MODELS)}). If chat requests "
                f"fail with a 400, update this setting or unset it to use "
                f"{DEFAULT_MODEL}.",
                RuntimeWarning,
                stacklevel=2,
            )
        return v

    # Service runtime --------------------------------------------------------
    max_concurrent_workflows: int = Field(
        8,
        description=(
            "Multi-agent runs allowed at once across all users. Each run makes "
            "several OpenAI calls, so this bounds both load and spend."
        ),
    )
    cors_allow_origins: str = Field(
        "",
        description=(
            "Comma-separated browser origins allowed to call the service directly. "
            "Empty (the default) disables CORS: in production only the webapp's "
            "server calls the service."
        ),
    )
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
