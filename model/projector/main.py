"""Axia XrayProcessor projector — CPU-only FastAPI server.

Downloads XrayProcessor weights + PCA/UMAP bundle from Hugging Face on first
startup, then serves ``/project`` and ``/health``.  No LLM, no GPU required.

Download strategy mirrors ``data/ingest/load_from_huggingface.py``:
  - Expected files are listed explicitly.
  - A completeness check skips the download if all files are already cached.
  - ``snapshot_download`` with ``local_dir`` is used for caching.
  - Subsequent starts reuse the cache without network access.
"""

import json
import logging
import os
import sys
import types
from pathlib import Path
from typing import List, Optional

# Numba old_scalars shim — the UMAP joblib was pickled with an older numba that
# stored random state under numba.core.types.old_scalars.  Newer numba moved
# them to numba.core.types.scalars.  This shim must run before joblib.load().
try:
    import numba.core.types.old_scalars  # noqa: F401
except ModuleNotFoundError:
    from numba.core.types import scalars as _scalars
    _shim = types.ModuleType("numba.core.types.old_scalars")
    _shim.__dict__.update(_scalars.__dict__)
    sys.modules["numba.core.types.old_scalars"] = _shim

import joblib
import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from xray_processor import XrayProcessor
from preprocess import source_to_xray_tensors, prune

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

HF_REPO_ID = os.getenv("HF_REPO_ID", "astromindinc/axia-qwen-xray-7b")
CACHE_DIR = Path(os.getenv("PROJECTOR_CACHE_DIR", "/tmp/axia-projector"))

EXPECTED_FILES = [
    "projector/xray_processor.pt",
    "projector/projector_config.json",
    "projector/global_stats.json",
    "pca_umap/xray_umap_pca_bundle.joblib",
]

app = FastAPI(
    title="Axia XrayProcessor Projector",
    description="CPU-only server for generating pca_64d / umap_2d from raw event lists.",
    version="1.0.0",
)

xray_processor: Optional[XrayProcessor] = None
preproc_loaded = None  # sklearn Pipeline: Normalizer -> PCA(64)
umap_loaded = None
global_stats: dict = {}


def _human_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def _has_complete_cache(cache_dir: Path) -> bool:
    return all(
        (cache_dir / f).exists() and (cache_dir / f).stat().st_size > 0
        for f in EXPECTED_FILES
    )


def _download_weights() -> Path:
    """Download projector + pca_umap artifacts from HF Hub (cached).

    Follows the same pattern as ``data/ingest/load_from_huggingface.py``:
    check for a complete local cache first, skip the download if present.
    """
    from huggingface_hub import snapshot_download

    if _has_complete_cache(CACHE_DIR):
        size = sum((CACHE_DIR / f).stat().st_size for f in EXPECTED_FILES)
        logger.info(
            "Using cached weights at %s (%d files, ~%s on disk)",
            CACHE_DIR,
            len(EXPECTED_FILES),
            _human_bytes(size),
        )
        return CACHE_DIR

    logger.info("Downloading weights from %s ...", HF_REPO_ID)
    logger.info("  target: %s", CACHE_DIR)
    logger.info("  (this is a one-time download; subsequent starts reuse the cache)")

    snapshot_download(
        repo_id=HF_REPO_ID,
        repo_type="model",
        allow_patterns=["projector/*", "pca_umap/*"],
        local_dir=str(CACHE_DIR),
        token=os.getenv("HF_TOKEN") or None,
    )

    if not _has_complete_cache(CACHE_DIR):
        missing = [f for f in EXPECTED_FILES if not (CACHE_DIR / f).exists()]
        raise RuntimeError(f"Download incomplete; missing: {missing}")

    size = sum((CACHE_DIR / f).stat().st_size for f in EXPECTED_FILES)
    logger.info("Download complete (%s on disk)", _human_bytes(size))
    return CACHE_DIR


@app.on_event("startup")
async def startup_event():
    global xray_processor, preproc_loaded, umap_loaded, global_stats

    root = _download_weights()

    config_path = root / "projector" / "projector_config.json"
    stats_path = root / "projector" / "global_stats.json"
    weights_path = root / "projector" / "xray_processor.pt"
    bundle_path = root / "pca_umap" / "xray_umap_pca_bundle.joblib"

    with open(config_path) as f:
        config = json.load(f)
    with open(stats_path) as f:
        global_stats = json.load(f)

    state_dict = torch.load(weights_path, map_location="cpu", weights_only=True)

    # Infer hidden_size from the checkpoint (to_hidden.0 is Linear(concat_dim, hidden_size))
    # so its weight shape is [hidden_size, concat_dim].
    if "to_hidden.0.weight" in state_dict:
        actual_hidden = state_dict["to_hidden.0.weight"].shape[0]
        if config.get("hidden_size") != actual_hidden:
            logger.warning(
                "projector_config.json says hidden_size=%s but checkpoint has %s; using checkpoint value.",
                config.get("hidden_size"),
                actual_hidden,
            )
            config["hidden_size"] = actual_hidden

    logger.info("Loading XrayProcessor (config=%s) ...", config)
    xray_processor = XrayProcessor(**config)
    xray_processor.load_state_dict(state_dict)
    xray_processor.eval()
    logger.info(
        "XrayProcessor loaded (%s params)",
        f"{sum(p.numel() for p in xray_processor.parameters()):,}",
    )

    bundle = joblib.load(bundle_path)
    preproc_loaded = bundle["preproc"]
    umap_loaded = bundle["umap"]
    logger.info("PCA/UMAP bundle loaded from %s", bundle_path)


@app.get("/health")
async def health():
    if xray_processor is None:
        raise HTTPException(503, detail="XrayProcessor not loaded")
    if preproc_loaded is None or umap_loaded is None:
        raise HTTPException(503, detail="PCA/UMAP bundle not loaded")
    return {"status": "healthy", "model": "xray-projector"}


class ProjectionRequest(BaseModel):
    event_list: List[List[float]] = Field(..., description="[[time, energy], ...]")
    is_pruned: bool = Field(False, description="If true, skip pruning.")


class ProjectionResponse(BaseModel):
    pca_64d: List[float] = Field(default_factory=list)
    umap_2d: List[float] = Field(default_factory=list)
    pruned_event_list: List[List[float]] = Field(default_factory=list)
    input_event_list: List[List[float]] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)


@app.post("/project", response_model=ProjectionResponse)
async def project(request: ProjectionRequest):
    if xray_processor is None:
        raise HTTPException(503, detail="XrayProcessor not loaded")
    if preproc_loaded is None or umap_loaded is None:
        raise HTTPException(503, detail="PCA/UMAP bundle not loaded")

    original_list = request.event_list

    if not request.is_pruned:
        pruned_arr, prune_errors = prune(original_list, T=28800)
        if pruned_arr is None or prune_errors:
            return ProjectionResponse(
                pruned_event_list=(pruned_arr.tolist() if isinstance(pruned_arr, np.ndarray) else []),
                input_event_list=original_list,
                errors=prune_errors or ["Pruning failed"],
            )
        pruned_list = pruned_arr.astype(float).tolist()
    else:
        pruned_list = original_list

    # 1) XrayProcessor forward pass
    try:
        tensors = source_to_xray_tensors(pruned_list, global_stats, max_events=512)
        batch = {}
        for k, v in tensors.items():
            t = torch.tensor(v)
            if k == "event_mask":
                t = t.bool()
            if t.dim() == 1:
                t = t.unsqueeze(0)
            elif t.dim() == 2:
                t = t.unsqueeze(0)
            batch[k] = t.float() if t.dtype.is_floating_point else t

        with torch.no_grad():
            emb = xray_processor(
                batch["per_event"],
                event_mask=batch["event_mask"],
                meta_token=batch["meta_token"],
                spec_vec=batch["spec_vec"],
                psd_vec=batch["psd_vec"],
            )
        emb_np = emb.cpu().numpy().reshape(1, -1).astype(np.float32)
    except Exception as e:
        return ProjectionResponse(
            pruned_event_list=pruned_list,
            input_event_list=original_list,
            errors=[f"Embedding failed: {e}"],
        )

    # 2) PCA(64)
    try:
        pca_64 = preproc_loaded.transform(emb_np)
    except Exception as e:
        return ProjectionResponse(
            pruned_event_list=pruned_list,
            input_event_list=original_list,
            errors=[f"PCA transform failed: {e}"],
        )

    # 3) UMAP(2)
    try:
        umap_2d = umap_loaded.transform(pca_64)
    except Exception as e:
        return ProjectionResponse(
            pca_64d=pca_64.ravel().astype(float).tolist(),
            pruned_event_list=pruned_list,
            input_event_list=original_list,
            errors=[f"UMAP transform failed: {e}"],
        )

    return ProjectionResponse(
        pca_64d=pca_64.ravel().astype(float).tolist(),
        umap_2d=umap_2d.ravel().astype(float).tolist(),
        pruned_event_list=pruned_list,
        input_event_list=original_list,
        errors=[],
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=False, log_level="info")
