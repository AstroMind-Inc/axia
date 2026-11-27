"""Consolidated pydantic models for the service HTTP API."""

import math
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, validator

from src.api.limits import (
    MAX_HISTORY_CHARS,
    MAX_HISTORY_MESSAGES,
    MAX_MESSAGE_CHARS,
)


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=MAX_MESSAGE_CHARS * 2)


class ContextSettings(BaseModel):
    enabled: bool
    selected_fields: List[str] = Field([], alias="selectedFields")
    dataset: str = "default_dataset"

    class Config:
        populate_by_name = True


class AgentConfig(BaseModel):
    """Toggles for the five optional agents in the multi-agent workflow."""

    eventAnalyst: bool = True
    metadataAnalyst: bool = True
    neighborAnalyst: bool = True
    critic: bool = True
    toolAgent: bool = True

    class Config:
        populate_by_name = True


class ChatRequest(BaseModel):
    message: str = Field(..., max_length=MAX_MESSAGE_CHARS)
    history: List[ChatMessage] = Field(..., max_length=MAX_HISTORY_MESSAGES)
    model: str
    response_format: str
    openai_model: Optional[str] = None
    embedding: Optional[List[float]] = None
    event_list: Optional[List[List[float]]] = None
    data_obj: Optional[Dict[str, Any]] = None
    neighbors: Optional[List[Dict[str, Any]]] = None
    context_settings: Optional[ContextSettings] = None
    # Honoured only when ALLOW_CUSTOM_MODEL_URL=true (see src/api/model_url.py).
    model_api_url: Optional[str] = None
    max_new_tokens: Optional[int] = Field(500, ge=1, le=2048)
    temperature: Optional[float] = 0.8
    thread_id: Optional[str] = None
    agent_config: Optional[AgentConfig] = None

    @field_validator("history")
    @classmethod
    def _bound_history_size(cls, v: List[ChatMessage]) -> List[ChatMessage]:
        if sum(len(m.content) for m in v) > MAX_HISTORY_CHARS:
            raise ValueError(f"history exceeds {MAX_HISTORY_CHARS} characters in total")
        return v

    class Config:
        populate_by_name = True


class SourceMetadata(BaseModel):
    source_type: Optional[str] = None
    ra: Optional[float] = None
    dec: Optional[float] = None
    obi: Optional[int] = None
    region_id: Optional[int] = None
    src_cnts_aper_b: Optional[float] = None
    flux_significance_b: Optional[float] = None
    flux_aper_b: Optional[float] = None
    theta: Optional[float] = None
    flux_bb_aper_b: Optional[float] = None
    gti_mjd_obs: Optional[float] = None
    hard_hm: Optional[float] = None
    hard_hs: Optional[float] = None
    hard_ms: Optional[float] = None
    var_prob_b: Optional[float] = None
    var_index_b: Optional[float] = None
    powlaw_stat: Optional[float] = None
    apec_stat: Optional[float] = None
    brems_stat: Optional[float] = None
    bb_stat: Optional[float] = None
    powlaw_gamma_lolim: Optional[float] = None
    powlaw_gamma_hilim: Optional[float] = None
    thermal_classification: Optional[str] = None
    recommended_model: Optional[str] = None
    event_list: Optional[List[Dict[str, Any]]] = None

    @validator("*", pre=True)
    def _check_nan(cls, v):  # noqa: N805
        if isinstance(v, float) and math.isnan(v):
            return None
        return v

    class Config:
        json_encoders = {
            float: lambda v: None if isinstance(v, float) and math.isnan(v) else v
        }


class MatchingContent(BaseModel):
    text: str
    score: float
    source: str
    observation_id: str
    metadata: Optional[SourceMetadata] = None


class MetaData(BaseModel):
    matching_contents: List[MatchingContent]


class ChatResponse(BaseModel):
    fine_tune_model_response: str
    enhanced_response: Optional[str] = None
    meta_data: Optional[MetaData] = None
    debug_prompt: Optional[str] = None
    agent_conversation: Optional[List[Dict[str, Any]]] = None


class EmbeddingsRequest(BaseModel):
    event_list: List[List[float]]
    # Honoured only when ALLOW_CUSTOM_MODEL_URL=true (see src/api/model_url.py).
    model_api_url: Optional[str] = None
    is_pruned: Optional[bool] = False


class EmbeddingsResponse(BaseModel):
    pca_64d: Optional[List[float]] = None
    umap_2d: Optional[List[float]] = None
    pruned_event_list: Optional[List[List[float]]] = None
    input_event_list: Optional[List[List[float]]] = None
    errors: Optional[List[str]] = None
    error: Optional[str] = None
    is_insufficient_window: Optional[bool] = False


# ---------------------------------------------------------------------------
# Object details (light curve + spectrum snapshot)
# ---------------------------------------------------------------------------

class ObjectDetailsRequest(BaseModel):
    object_data: Dict[str, Any]


class SpectrumDataPoint(BaseModel):
    energy: float
    energy_min: float
    energy_max: float
    count: int


class RegionOfInterest(BaseModel):
    name: str
    energy_min: float
    energy_max: float
    energy_center: float
    count: int
    significance: str


class LightCurveStatistics(BaseModel):
    total_events: int
    energy_range: Dict[str, float]
    mean_energy: float
    peak_energy: float


class LightCurveData(BaseModel):
    total_events: int
    energy_spectrum: List[SpectrumDataPoint]
    regions_of_interest: List[RegionOfInterest]
    statistics: LightCurveStatistics


class ObjectDetailsResponse(BaseModel):
    success: bool
    object_data: Optional[Dict[str, Any]] = None
    light_curve: Optional[LightCurveData] = None
    spectrum_snapshot: Optional[Dict[str, Any]] = None
    spectrum_text: Optional[str] = None
    time_light_curve: Optional[Dict[str, Any]] = None
    gl_light_curve: Optional[Dict[str, Any]] = None
    de_dt_map: Optional[str] = None
    error: Optional[str] = None
