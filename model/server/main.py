# !pip install sentence-transformers matplotlib pandas google-api-python-client google-auth google-auth-httplib2 google-auth-oauthlib peft bitsandbytes accelerate  typing_extensions orjson openai fastapi uvicorn pydantic python-dotenv gunicorn python-multipart

# uvicorn main:app --host 0.0.0.0 --port 8000

import os
import torch
import logging
import traceback
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from transformers import AutoConfig, AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel
from base_functions import (
    Qwen2_5_XrayForConditionalGeneration,
    Qwen2_5_XrayConfig,
    source_to_xray_tensors,
    generate_answer,
    get_embedding,
    prune
)
import joblib
import numpy as np
from typing import Dict, List, Tuple, Any, Optional
from transformers import BitsAndBytesConfig
# --- Numba old_scalars shim for legacy pickles ---
# Some old pickles reference 'numba.core.types.old_scalars'.
# Newer Numba moved these under 'numba.core.types.scalars'.
try:
    import numba.core.types.old_scalars  # noqa: F401
except ModuleNotFoundError:
    import sys, types
    from numba.core.types import scalars as _scalars
    shim = types.ModuleType("numba.core.types.old_scalars")
    shim.__dict__.update(_scalars.__dict__)
    sys.modules["numba.core.types.old_scalars"] = shim
# -----------------------------------------------


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# FastAPI app
app = FastAPI(
    title="Deepseek-Qwen-Xray-Local API",
    description="API for generating answers using a locally fine-tuned Qwen X-ray model",
    version="1.0.0"
)

# Global placeholders
model = None
tokenizer = None
preproc_loaded = None  # sklearn Pipeline: L2 -> PCA(64)
umap_loaded = None     # fitted UMAP model
global_stats = {
          "logE_mean": 3.263709927970281,
          "logE_std": 0.26947376549240537,
          "abs_t_scale": 0.0001,
          "spec_edges_keV": [
            0.5, 0.6015625, 0.703125, 0.8046875, 0.90625, 1.0078125, 1.109375, 1.2109375, 1.3125, 1.4140625,
            1.515625, 1.6171875, 1.71875, 1.8203125, 1.921875, 2.0234375, 2.125, 2.2265625, 2.328125, 2.4296875,
            2.53125, 2.6328125, 2.734375, 2.8359375, 2.9375, 3.0390625, 3.140625, 3.2421875, 3.34375, 3.4453125,
            3.546875, 3.6484375, 3.75, 3.8515625, 3.953125, 4.0546875, 4.15625, 4.2578125, 4.359375, 4.4609375,
            4.5625, 4.6640625, 4.765625, 4.8671875, 4.96875, 5.0703125, 5.171875, 5.2734375, 5.375, 5.4765625,
            5.578125, 5.6796875, 5.78125, 5.8828125, 5.984375, 6.0859375, 6.1875, 6.2890625, 6.390625, 6.4921875,
            6.59375, 6.6953125, 6.796875, 6.8984375, 7.0
          ],
          "psd_freq_hz": [
            0.0001, 0.00011731288478870299, 0.000137623129374475, 0.0001614496632056857, 0.00018940125738823506,
            0.00022219207886821498, 0.0002606599374922931, 0.00030578769216063937, 0.0003587283630024446, 0.0004208345911934581,
            0.0004936931991177906, 0.0005791657338907159, 0.0006794360301348616, 0.0007970660072450482, 0.0009350611267692985,
            0.0010969471823508163, 0.0012868603842241368, 0.0015096530399363222, 0.0017710175314496499, 0.0020776317562572594,
            0.002437329748551585, 0.0028593018398391052, 0.003354329473131718, 0.0039350606702485205, 0.00461633319045421,
            0.00541555363718021, 0.006353142199055634, 0.007453054388440607, 0.0087433931079507, 0.010257126683353603,
            0.012032931208673938, 0.014116178725535541, 0.01656009648485491, 0.019427126910175896, 0.022790523009889763,
            0.026736220001334847, 0.03136503096702011, 0.03679522264228132, 0.043165537146086244, 0.050638736860612994,
            0.0594057630317454, 0.06969061434328139, 0.08175607011307301, 0.09591040433952058, 0.11251526214320108,
            0.13199489984776064, 0.15484702478536733, 0.18165551178519232, 0.21310532125289144, 0.25
          ]
        }


def load_peft_model_and_tokenizer(
    base_model_name: str,
    adapter_dir: str,
    device: str = "cuda",
    cache_dir: str = "/workspace/cache"
):
    # Register custom model class
    AutoConfig.register("qwen2_5_xray", Qwen2_5_XrayConfig)
    AutoModelForCausalLM.register(Qwen2_5_XrayConfig, Qwen2_5_XrayForConditionalGeneration)

    # Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained(adapter_dir, cache_dir=cache_dir)
    # Load base model
    base_model = Qwen2_5_XrayForConditionalGeneration.from_pretrained(
        pretrained_model_name_or_path=base_model_name,
        torch_dtype=torch.float16,
        low_cpu_mem_usage=True,
        cache_dir=cache_dir
    )
    base_model.eval()

    # Resize embeddings & load LoRA adapter
    base_model.resize_token_embeddings(len(tokenizer))
    model = PeftModel.from_pretrained(
        base_model,
        adapter_dir,
        torch_dtype=torch.float16
    ).merge_and_unload()
    # Set xray token id in config
    xray_id = tokenizer.convert_tokens_to_ids("<xray>")
    model.config.xray_token_id = xray_id

    # Move to device
    model.to(device)
    model.eval()

    return model, tokenizer


@app.on_event("startup")
async def startup_event():
    global model, tokenizer, preproc_loaded, umap_loaded
    logger.info("Loading PEFT model and tokenizer...")
    base_model = os.getenv("BASE_MODEL_NAME", "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B")
    adapter_dir = os.getenv("ADAPTER_DIR", "/workspace/qwen-7b/final_model_7B-9-epochs")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model, tokenizer = load_peft_model_and_tokenizer(
        base_model_name=base_model,
        adapter_dir=adapter_dir,
        device=device
    )

    logger.info(f"Model loaded on {device}")

    # --- load PCA+UMAP bundle ---
    bundle_path = os.getenv("UMAP_PCA_BUNDLE", "/workspace/qwen-7b/final_model_7B-9-epochs/pca_umap/xray_umap_pca_bundle.joblib")
    if not os.path.exists(bundle_path):
        logger.error(f"UMAP/PCA bundle not found at {bundle_path}. Set UMAP_PCA_BUNDLE env var.")
        return
    try:
        bundle = joblib.load(bundle_path)
        preproc_loaded = bundle["preproc"]  # sklearn Pipeline (Normalizer->PCA64)
        umap_loaded = bundle["umap"]        # fitted UMAP
        logger.info(f"Loaded PCA/UMAP bundle from {bundle_path}")
    except Exception as e:
        logger.error(f"Failed to load PCA/UMAP bundle: {e}")

@app.get("/health")
async def health_check():
    if model is None or tokenizer is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    return {"status": "healthy", "model": model.config._name_or_path}


# Request / response schemas
class InferenceRequest(BaseModel):
    event_list: List[List[float]] = Field(
        ..., description="List of [time, energy] pairs"
    )
    prompt: str = Field(..., description="User question for the X-ray data")
    max_new_tokens: int = Field(150, description="Max tokens to generate")
    temperature: float = Field(0.7, description="Sampling temperature")


class InferenceResponse(BaseModel):
    answer: str = Field(..., description="Generated answer")
    full_prompt: str = Field(..., description="Full prompt used for generation")
    errors: List[str] = Field(default_factory=list, description="Processing or generation errors")


class ProjectionRequest(BaseModel):
    event_list: List[List[float]] = Field(..., description="List of [time, energy] pairs")
    is_pruned: bool = Field(False, description="If true, skip pruning and use event_list as-is")
    
class ProjectionResponse(BaseModel):
    pca_64d: List[float] = Field(default_factory=list)
    umap_2d: List[float] = Field(default_factory=list)
    pruned_event_list: List[List[float]] = Field(default_factory=list)
    input_event_list: List[List[float]] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)

    
@app.post("/inference", response_model=InferenceResponse)
async def inference(request: InferenceRequest):
    errors: List[str] = []

    # Prepare data
    try:
        processed = source_to_xray_tensors(
            request.event_list, global_stats, max_events=512
        )
    except Exception as e:
        err = f"Data preprocessing failed: {str(e)}"
        logger.error(err)
        return InferenceResponse(
            answer="Unable to process event data",
            full_prompt="",
            errors=[err]
        )

    # Generate answer
    try:
        prompt, answer = generate_answer(
            model,
            tokenizer,
            processed,
            request.prompt,
            max_new_tokens=request.max_new_tokens,
            temperature=request.temperature
        )
        return InferenceResponse(answer=answer, full_prompt=prompt, errors=errors)
    except Exception as e:
        err = str(e)
        logger.error(f"Generation error: {err}")
        logger.error(traceback.format_exc())
        errors.append(err)
        return InferenceResponse(
            answer="Error generating answer",
            full_prompt="",
            errors=errors
        )

@app.post("/project", response_model=ProjectionResponse)
async def project(request: ProjectionRequest):
    logger.info("Inside project API Call log")
    print("Inside project API Call print")
    if model is None or tokenizer is None:
        logger.info("Model not loaded Exception")
        raise HTTPException(status_code=503, detail="Model not loaded")
    if preproc_loaded is None or umap_loaded is None:
        logger.info("PCA/UMAP bundle not loaded Exception")
        raise HTTPException(status_code=503, detail="PCA/UMAP bundle not loaded")
    logger.info("Starting...")
    original_list = request.event_list
    is_pruned = bool(getattr(request, "is_pruned", False))  # default: not pruned yet

    # 0) Prune only if data is NOT already pruned
    if not is_pruned:
        pruned_arr, prune_errors = prune(original_list, T=getattr(request, "prune_T", 28800))
        if pruned_arr is None or prune_errors:
            return ProjectionResponse(
                pca_64d=[],
                umap_2d=[],
                pruned_event_list=(pruned_arr.tolist() if isinstance(pruned_arr, np.ndarray) else []),
                input_event_list=original_list,
                errors=prune_errors if prune_errors else ["Pruning failed"]
            )
        pruned_list = pruned_arr.astype(float).tolist()
    else:
        # trust the caller's list as already pruned
        pruned_list = original_list

    # 1) Embedding
    try:
        emb = get_embedding(model, pruned_list, global_stats)  # -> 1D array-like
        emb = np.asarray(emb, dtype=np.float32).reshape(1, -1)
    except Exception as e:
        err = f"Embedding failed: {e}"
        logger.error(err)
        return ProjectionResponse(
            pca_64d=[],
            umap_2d=[],
            pruned_event_list=pruned_list,
            input_event_list=original_list,
            errors=[err]
        )

    # 2) PCA(64)
    try:
        pca_64 = preproc_loaded.transform(emb)  # (1, 64)
    except Exception as e:
        err = f"PCA transform failed: {e}"
        logger.error(err)
        return ProjectionResponse(
            pca_64d=[],
            umap_2d=[],
            pruned_event_list=pruned_list,
            input_event_list=original_list,
            errors=[err]
        )

    # 3) UMAP(2)
    try:
        umap_2d = umap_loaded.transform(pca_64)  # (1, 2)
    except Exception as e:
        err = f"UMAP transform failed: {e}"
        logger.error(err)
        return ProjectionResponse(
            pca_64d=pca_64.ravel().astype(float).tolist(),
            umap_2d=[],
            pruned_event_list=pruned_list,
            input_event_list=original_list,
            errors=[err]
        )

    return ProjectionResponse(
        pca_64d=pca_64.ravel().astype(float).tolist(),
        umap_2d=umap_2d.ravel().astype(float).tolist(),
        pruned_event_list=pruned_list,
        input_event_list=original_list,
        errors=[]
    )
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False, log_level="info")
