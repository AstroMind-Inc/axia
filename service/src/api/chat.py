"""Chat router + helpers.

Streams the multi-agent workflow over Server-Sent Events. The workflow runs as
a background asyncio task driven by an in-memory queue, so the workflow
finishes even if the SSE client disconnects.

Persistence of chat history (threads / messages / requests) is intentionally
absent in axia. The Atlas-backed persistence layer in the original code was
already disabled in production due to write latency; we drop it to keep the
reference implementation focused on the multi-agent flow.
"""

import asyncio
import json
import logging
from typing import AsyncGenerator
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from src.agents.infer import generate_multi_agent_response
from src.api._task_manager import get_background_task_manager
from src.api.models import (
    ChatMessage,
    ChatRequest,
    EmbeddingsRequest,
    EmbeddingsResponse,
)
from src.core.logger import get_logger
from src.core.settings import get_settings
from src.llm.qwen_xray_client import generate_embeddings

router = APIRouter()
logger = get_logger(__name__)
settings = get_settings()


# ---------------------------------------------------------------------------
# Background workflow
# ---------------------------------------------------------------------------

async def _run_workflow_background(request_id: str, request: ChatRequest, history: list[ChatMessage]) -> None:
    """Run the multi-agent workflow as a background task, pushing updates into the queue."""

    task_manager = get_background_task_manager()

    agent_config_dict = None
    if request.agent_config is not None:
        agent_config_dict = {
            "eventAnalyst": request.agent_config.eventAnalyst,
            "metadataAnalyst": request.agent_config.metadataAnalyst,
            "neighborAnalyst": request.agent_config.neighborAnalyst,
            "critic": request.agent_config.critic,
            "toolAgent": request.agent_config.toolAgent,
        }

    # Disable Event Analyst if the model server isn't configured
    if not settings.model_server_configured:
        agent_config_dict = agent_config_dict or {}
        if agent_config_dict.get("eventAnalyst", True):
            logger.info(
                "MODEL_SERVER_URL is not set; disabling Event Analyst for this run."
            )
        agent_config_dict["eventAnalyst"] = False

    final_response = None
    agent_conversation: list = []
    tool_executions: list = []
    artifacts: list = []

    try:
        async for update in generate_multi_agent_response(
            user_message=request.message,
            data_obj=request.data_obj,
            history=history,
            event_list=request.event_list,
            model_api_url=request.model_api_url or settings.model_server_url,
            neighbors=request.neighbors,
            openai_model=request.openai_model,
            response_format=request.response_format,
            agent_config=agent_config_dict,
        ):
            await task_manager.put_update(request_id, update, timeout=0.5)
            if update.get("type") == "final":
                full = update.get("full_result") or {}
                final_response = full.get("response")
                agent_conversation = full.get("agent_conversation", [])
                tool_executions = full.get("tool_executions", [])
                artifacts = full.get("artifacts", [])

        await task_manager.put_update(request_id, {"type": "completed"}, timeout=0.5)
        task_manager.store_workflow_result(
            request_id,
            {
                "response": final_response,
                "agent_conversation": agent_conversation,
                "tool_executions": tool_executions,
                "artifacts": artifacts,
            },
        )
    except Exception as e:  # noqa: BLE001
        logger.error("Workflow failed for request %s: %s", request_id, e, exc_info=True)
        await task_manager.put_update(
            request_id,
            {"type": "error", "message": f"Workflow failed: {e}", "error": str(e)},
            timeout=0.5,
        )


# ---------------------------------------------------------------------------
# Streaming generator
# ---------------------------------------------------------------------------

async def process_streaming_chat_request(request: ChatRequest) -> AsyncGenerator[dict, None]:
    """Yield SSE-friendly dicts for a chat request."""

    task_manager = get_background_task_manager()

    if request.model != "astromind-multi-agent":
        yield {
            "type": "error",
            "message": "Streaming is only supported for astromind-multi-agent model",
            "error": "unsupported_model",
        }
        return

    if request.data_obj is None:
        yield {
            "type": "error",
            "message": "Data object is required for multi-agent analysis",
            "error": "missing_data_obj",
        }
        return

    request_id = str(uuid4())
    history = list(request.history) if request.history else []
    if not history or history[-1].role != "user":
        history.append(ChatMessage(role="user", content=request.message))

    task_manager.create_workflow_queue(request_id)
    task_manager.start_background_task(
        request_id,
        _run_workflow_background(request_id, request, history),
        cleanup_on_complete=True,
    )

    yield {"type": "init", "request_id": request_id, "message": "Background workflow started"}

    while True:
        try:
            update = await task_manager.get_update(request_id, timeout=1.0)
            if update is None:
                yield {"type": "keepalive"}
                continue
            if update.get("type") in ("completed", "final", "cleanup"):
                if update.get("type") == "final":
                    yield update
                break
            if update.get("type") == "error":
                yield update
                break
            yield update
        except asyncio.CancelledError:
            logger.warning("Client disconnected (request_id=%s); background task continues.", request_id)
            break


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    """Server-sent stream of multi-agent updates."""

    async def generate():
        try:
            async for update in process_streaming_chat_request(request):
                yield f"data: {json.dumps(update)}\n\n"
            yield f"data: {json.dumps({'type': 'complete'})}\n\n"
        except Exception as e:  # noqa: BLE001
            logger.error("Streaming chat failed: %s", e, exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'message': str(e), 'error': str(e)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Cache-Control",
        },
    )


@router.post("/embeddings", response_model=EmbeddingsResponse)
async def generate_embeddings_route(request: EmbeddingsRequest):
    """Project an event_list to (pca_64d, umap_2d) via the model server."""

    model_url = request.model_api_url or settings.model_server_url
    if not model_url:
        return EmbeddingsResponse(
            error="MODEL_SERVER_URL is not configured; embedding generation is disabled.",
            is_insufficient_window=False,
        )

    if not request.event_list:
        return EmbeddingsResponse(error="Event list is empty or missing.")

    pca_64d, umap_2d, error, pruned_event_list, input_event_list = await generate_embeddings(
        model_url,
        request.event_list,
        bool(request.is_pruned),
    )

    if error:
        lc = error.lower()
        window_err = any(
            s in lc
            for s in (
                "8.00 hours",
                "not enough seconds",
                "required duration",
                "observation window",
            )
        )
        return EmbeddingsResponse(error=error, is_insufficient_window=window_err)

    return EmbeddingsResponse(
        pca_64d=pca_64d,
        umap_2d=umap_2d,
        pruned_event_list=pruned_event_list,
        input_event_list=input_event_list,
        errors=[],
        is_insufficient_window=False,
    )
