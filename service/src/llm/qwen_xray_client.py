import aiohttp
import json
import asyncio
from typing import List, Dict, Any, Literal, Optional, Tuple

from src.api.models import ChatMessage


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

    headers = {
        "Content-Type": "application/json"
    }

    try:
        async with aiohttp.ClientSession() as session:
            print("Sending request to:", url)
            async with session.post(url, headers=headers, json=payload) as response:
                response.raise_for_status()
                response_data = await response.json()
                # Extract answer from response, ignoring processed_data
                if "answer" in response_data:
                    return response_data["answer"], response_data.get("full_prompt")
                else:
                    return "No answer found in the response", None


    except aiohttp.ClientError as e:
        return f"Error making API request: {str(e)}", None
    except json.JSONDecodeError:
        return "Error parsing response as JSON", None
    except Exception as e:
        return f"Unexpected error: {str(e)}", None


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
    print("🔥 generate_embeddings function called in infer.py")
    print(f"📊 Event list length: {len(event_list)}")
    print(f"🌐 Base URL: {base_url}")
    
    # Ensure the base_url doesn't end with a slash
    if base_url.endswith('/'):
        base_url = base_url[:-1]

    url = f"{base_url}/project"
    print(f"🎯 Full URL: {url}")

    payload = {
        "event_list": event_list,
        "is_pruned": is_pruned
    }

    headers = {
        "Content-Type": "application/json"
    }

    try:
        async with aiohttp.ClientSession() as session:
            print(f"Requesting embeddings from: {url}")
            async with session.post(url, headers=headers, json=payload) as response:
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

    except aiohttp.ClientError as e:
        return None, None, f"Error making API request: {str(e)}", None, None
    except json.JSONDecodeError:
        return None, None, "Error parsing response as JSON", None, None
    except Exception as e:
        return None, None, f"Unexpected error: {str(e)}", None, None