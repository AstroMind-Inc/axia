"""GPT-as-judge accuracy validation for chat responses.

Used by the "Validate" button in the playground: given the assistant's answer
+ the source context, produces an `accuracy_rating` (1-10) and a short
markdown explanation.
"""

import asyncio
import json
from typing import Any, Dict

from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

from src.core.logger import get_logger
from src.core.settings import get_settings

logger = get_logger(__name__)


def _extract_json(response) -> Dict[str, Any]:
    """Pull the JSON payload (and optional reasoning) out of an OpenAI Responses object."""
    reasoning_content: list = []
    has_reasoning = False

    if hasattr(response, "output") and response.output:
        for item in response.output:
            if getattr(item, "type", None) == "reasoning":
                has_reasoning = True
                if hasattr(item, "text"):
                    reasoning_content.append(item.text)
                if getattr(item, "summary", None):
                    reasoning_content.extend(item.summary)

    json_data = None
    if hasattr(response, "output") and response.output:
        for item in response.output:
            for content in getattr(item, "content", []) or []:
                text = getattr(content, "text", None)
                if not text:
                    continue
                try:
                    json_data = json.loads(text)
                    break
                except json.JSONDecodeError:
                    continue
            if json_data is not None:
                break

    if json_data is None and getattr(response, "content", None):
        try:
            json_data = json.loads(response.content)
        except json.JSONDecodeError:
            json_data = None

    if json_data is None:
        raise ValueError("No JSON content found in the validation response")

    result = json_data if isinstance(json_data, dict) else {"result": json_data}
    if has_reasoning and reasoning_content:
        result["reasoning_context"] = reasoning_content
    return result


_RESPONSE_FORMAT = {
    "format": {
        "type": "json_schema",
        "name": "accuracy_evaluation",
        "schema": {
            "type": "object",
            "properties": {
                "accuracy_rating": {
                    "type": "integer",
                    "description": "Rating 1-10 (1 = not accurate, 10 = perfect)",
                },
                "evaluation": {
                    "type": "string",
                    "description": "Concise markdown explanation",
                },
            },
            "required": ["accuracy_rating", "evaluation"],
            "additionalProperties": False,
        },
        "strict": True,
    }
}


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=6), reraise=True)
async def _call_openai(client: OpenAI, **kwargs):
    return await asyncio.to_thread(client.responses.create, **kwargs)


async def validate_with_openai(user_message: str, answer: str, context_str: str) -> Dict[str, Any]:
    """Ask GPT to score `answer` against `context_str` for the question `user_message`."""

    settings = get_settings()
    if not settings.openai_api_key:
        return {
            "result": {"error": "**Error**: OPENAI_API_KEY is not configured."},
            "api_call_details": {"model": "o3-mini", "error": "OPENAI_API_KEY missing"},
        }

    prompt = (
        f"Given this truth:\n\n"
        f"{context_str}\n\n"
        f"Is this answer:\n\"{answer}\"\n\n"
        f"To this question:\n\"{user_message}\"\n\n"
        "Accurate? Reply with a rating of 1-10 on accuracy, with 1 being not accurate at "
        "all and 10 being totally accurate, as well as your logic. Be very succinct and "
        "straightforward. No more than 3 declarative sentences. Do not say things like "
        "\"the text says\" or \"the data says\" - just say what is. Reply in markdown."
    )

    client = OpenAI(api_key=settings.openai_api_key)

    try:
        response = await _call_openai(
            client,
            model="o3-mini",
            reasoning={"effort": "medium"},
            text=_RESPONSE_FORMAT,
            truncation="auto",
            input=[
                {
                    "role": "system",
                    "content": [
                        {
                            "type": "input_text",
                            "text": "You are validating the accuracy of an answer to a question about an astronomical object.",
                        }
                    ],
                },
                {
                    "role": "user",
                    "content": [{"type": "input_text", "text": prompt}],
                },
            ],
            max_output_tokens=5000,
        )
        result = _extract_json(response)
        return {
            "result": result,
            "api_call_details": {"model": "o3-mini", "prompt": prompt, "max_tokens": 5000},
        }
    except Exception as e:  # noqa: BLE001
        logger.error("OpenAI validation call failed: %s", e)
        return {
            "result": {"error": f"**Error**: Failed to validate answer due to API error.\n\n{e}"},
            "api_call_details": {"model": "o3-mini", "error": str(e), "prompt": prompt},
        }
