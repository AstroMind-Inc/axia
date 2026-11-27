import aiohttp
import json
import asyncio
from typing import List, Dict, Any, Literal, Optional, Tuple

from src.api.models import ChatMessage
from src.core.logger import get_logger
from src.core.settings import get_settings

logger = get_logger(__name__)

# Generation on the model server can take minutes; the projector is quicker.
_INFERENCE_TIMEOUT = aiohttp.ClientTimeout(total=600, connect=10)
_PROJECT_TIMEOUT = aiohttp.ClientTimeout(total=300, connect=10)


def _headers() -> Dict[str, str]:
    headers = {"Content-Type": "application/json"}
    token = get_settings().model_server_token
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


async def generate_response(
    base_url: str,
    prompt: str,
    history: List[Dict[str, str]],
    embedding: Optional[List[float]] = None,
    event_list: Optional[List[List[float]]] = None,
    max_new_tokens: int = 500,
    temperature: float = 0.8
) -> Tuple[str, str]:
    """
    Generate a response using the Qwen-7b model.
    
    Args:
        base_url: The base URL for the model API
        prompt: The user's prompt
        history: Chat history
        embedding: Optional embedding vector
        event_list: Optional list of event data points
        max_new_tokens: Maximum number of tokens to generate
        temperature: Temperature for response generation
    """
    # Ensure the base_url doesn't end with a slash
    if base_url.endswith('/'):
        base_url = base_url[:-1]

    url = f"{base_url}/inference"

    processed_history = []
    for msg in history:
        # If it's a ChatMessage object, convert to dict
        if isinstance(msg, ChatMessage):
            processed_history.append({
                "role": msg.role,
                "content": msg.content
            })
        # If it's already a dict that has role and content
        elif isinstance(msg, dict) and "role" in msg and "content" in msg:
            processed_history.append(msg)
        # If it's something else, skip it
        else:
            continue

    # Prepare the payload based on what's provided
    payload = {
        "prompt": prompt,
        "history": processed_history,
        "max_new_tokens": max_new_tokens,
        "temperature": temperature
    }
    
    if embedding is not None:
        payload["xray_embedding"] = embedding
    if event_list is not None:
        payload["event_list"] = event_list

    headers = _headers()

    try:
        async with aiohttp.ClientSession(timeout=_INFERENCE_TIMEOUT) as session:
            # Redirects are not followed: a redirect is the classic way to
            # bounce a server-side request onto an internal address.
            async with session.post(url, headers=headers, json=payload, allow_redirects=False) as response:
                response.raise_for_status()
                response_data = await response.json()
                # Extract answer from response, ignoring processed_data
                if "answer" in response_data:
                    return response_data["answer"], response_data.get("full_prompt")
                else:
                    return "No answer found in the response", None


    # The exception text names the model server's host, which users should
    # not learn; it goes to the log only.
    except (aiohttp.ClientError, asyncio.TimeoutError) as e:
        logger.error("Model server request failed: %s", e)
        return "Error: the event model is unavailable right now.", None
    except json.JSONDecodeError:
        return "Error parsing response as JSON", None
    except Exception as e:
        logger.error("Model server request failed unexpectedly: %s", e, exc_info=True)
        return "Error: the event model is unavailable right now.", None


async def generate_embeddings(
    base_url: str,
    event_list: List[List[float]],
    is_pruned: bool = False
) -> Tuple[Optional[List[float]], Optional[List[float]], Optional[str], Optional[List[List[float]]], Optional[List[List[float]]]]:
    """
    Generate PCA 64D and UMAP 2D embeddings from event list data.
    
    Args:
        base_url: The base URL for the model API
        event_list: List of event data points
    
    Returns:
        Tuple of (pca_64d, umap_2d, error_message, pruned_event_list, input_event_list)
    """
    logger.info("Requesting embeddings for %d events", len(event_list))

    # Ensure the base_url doesn't end with a slash
    if base_url.endswith('/'):
        base_url = base_url[:-1]

    url = f"{base_url}/project"

    payload = {
        "event_list": event_list,
        "is_pruned": is_pruned
    }

    headers = _headers()

    try:
        async with aiohttp.ClientSession(timeout=_PROJECT_TIMEOUT) as session:
            async with session.post(url, headers=headers, json=payload, allow_redirects=False) as response:
                response.raise_for_status()
                response_data = await response.json()
                
                pca_64d = response_data.get("pca_64d")
                umap_2d = response_data.get("umap_2d")
                pruned_event_list = response_data.get("pruned_event_list")
                input_event_list = response_data.get("input_event_list")
                errors = response_data.get("errors", [])
                
                if errors:
                    error_msg = f"API returned errors: {', '.join(errors)}"
                    return None, None, error_msg, None, None
                
                if pca_64d is None or umap_2d is None:
                    return None, None, "Missing pca_64d or umap_2d in response", None, None
                
                return pca_64d, umap_2d, None, pruned_event_list, input_event_list

    except (aiohttp.ClientError, asyncio.TimeoutError) as e:
        logger.error("Projector request failed: %s", e)
        return None, None, "The embedding service is unavailable right now.", None, None
    except json.JSONDecodeError:
        return None, None, "Error parsing response as JSON", None, None
    except Exception as e:
        logger.error("Projector request failed unexpectedly: %s", e, exc_info=True)
        return None, None, "The embedding service is unavailable right now.", None, None