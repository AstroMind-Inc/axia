"""Validation router — POST /v1/validate."""

import traceback
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body
from pydantic import BaseModel

from src.core.logger import get_logger
from src.llm.validate import validate_with_openai

logger = get_logger(__name__)
router = APIRouter()


class SourceContext(BaseModel):
    source_name: Optional[str] = None
    source_type: Optional[str] = None
    answer: Optional[str] = None
    qna: Optional[List[Dict[str, str]]] = None


class ValidationRequest(BaseModel):
    sourceId: Optional[str] = None
    userMessage: Optional[str] = None
    answer: str
    context: Optional[List[str]] = None
    source_context: Optional[SourceContext] = None


class ValidationResponse(BaseModel):
    result: Dict[str, Any]
    api_call_details: Optional[Dict[str, Any]] = None


def _format_source_context(source_context: Optional[SourceContext]) -> str:
    if not source_context:
        return "This source is an astronomical object with limited context information."

    parts: List[str] = []
    if source_context.source_name:
        parts.append(f"Source Name: {source_context.source_name}")
    if source_context.source_type:
        parts.append(f"Source Type: {source_context.source_type}")
    if source_context.answer:
        parts.append(f"Source Description: {source_context.answer}")
    if source_context.qna:
        for q in source_context.qna:
            if "question" in q and "answer" in q:
                parts.append(f"Q: {q['question']}")
                parts.append(f"A: {q['answer']}")

    text = "\n".join(parts)
    if not text:
        text = "This source is an astronomical object with limited context information."
    if len(text) > 8000:
        logger.warning("Context truncated from %d to 8000 chars", len(text))
        text = text[:8000] + "...[truncated due to length]"
    return text


@router.post("/validate", response_model=ValidationResponse)
async def validate(request: ValidationRequest = Body(...)):
    try:
        logger.info("Validation request for source='%s'", request.sourceId)
        context_str = _format_source_context(request.source_context)
        # If the caller also passed a free-form context list, append it.
        if request.context:
            context_str += "\n\nAdditional context:\n" + "\n".join(request.context)

        result = await validate_with_openai(
            user_message=request.userMessage or "Tell me about this source.",
            answer=request.answer,
            context_str=context_str,
        )
        return ValidationResponse(**result)
    except Exception as e:  # noqa: BLE001
        logger.error("Validation failed: %s", e)
        logger.error(traceback.format_exc())
        return ValidationResponse(
            result={"error": f"**Error**: Failed to validate.\n\n{e}"},
            api_call_details={"error": str(e)},
        )
