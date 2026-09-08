"""
Simple OpenAI client utility for direct API calls.
"""

import asyncio
from typing import Tuple, List, Optional
from tenacity import retry, stop_after_attempt, wait_exponential
from openai import OpenAI

from src.core.logger import get_logger
from src.core.settings import get_settings
from src.llm.models import is_reasoning_model, resolve, sampling_kwargs

logger = get_logger(__name__)
settings = get_settings()


async def call_openai_api(
    prompt: str,
    max_tokens: int = 10000,
    temperature: float = 0.3,
    model: Optional[str] = None,
    images: Optional[List[str]] = None,
    reasoning_effort: Optional[str] = None,
) -> str:
    """
    Direct OpenAI API call without any prompt modification.
    Supports vision models with base64-encoded images.

    Args:
        prompt: The complete prompt to send to OpenAI
        max_tokens: Maximum tokens to generate
        temperature: Temperature for response generation. Ignored for reasoning
            models, which only accept the default and reject anything else.
        model: OpenAI model to use. Defaults to models.DEFAULT_MODEL.
        images: Optional list of base64-encoded images to include (for vision models)
        reasoning_effort: Optional override for reasoning models. See
            models.REASONING_EFFORTS.

    Returns:
        Response text from OpenAI
    """
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=6),
        reraise=True
    )
    async def make_api_call(func, **kwargs):
        return await asyncio.to_thread(func, **kwargs)

    # Get API key from settings
    api_key = settings.openai_api_key
    if not api_key:
        raise ValueError("OpenAI API key not found")

    model = resolve(model)
    # Reasoning models reject an explicit temperature, so the legal sampling
    # parameters are decided centrally rather than at each call site.
    tuning = sampling_kwargs(model, temperature, reasoning_effort=reasoning_effort)
    if is_reasoning_model(model):
        logger.info(
            "Calling OpenAI %s (reasoning_effort=%s, temperature omitted)",
            model, tuning.get("reasoning_effort"),
        )
    else:
        logger.info("Calling OpenAI %s (temperature=%s)", model, temperature)

    client = OpenAI(api_key=api_key)

    # Build user message content based on whether images are provided
    user_content = prompt
    if images and len(images) > 0:
        # For vision models, construct content as list with text and images
        content_parts = [{"type": "text", "text": prompt}]
        for img_base64 in images:
            content_parts.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/png;base64,{img_base64}"
                }
            })
        user_content = content_parts
        logger.info(f"Including {len(images)} image(s) in API request")

    response = await make_api_call(
        client.chat.completions.create,
        model=model,
        messages=[
            {
                "role": "system",
                "content": "You are an expert astrophysicist. Provide accurate, scientific responses based on the data provided."
            },
            {
                "role": "user", 
                "content": user_content
            }
        ],
        max_completion_tokens=max_tokens,
        **tuning,
    )

    response_text = response.choices[0].message.content
    
    logger.info(f"OpenAI response generated: {len(response_text)} characters")
    
    return response_text