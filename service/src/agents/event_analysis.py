"""
Simple event analysis helper functions.
"""

from typing import List
from ..llm.qwen_xray_client import generate_response

async def call_event_analysis(
    model_api_url: str,
    prompt: str,
    event_list: List[List[float]],
    max_new_tokens: int = 600,
    temperature: float = 0.5
) -> str:
    """
    Call the qwen-7b-raw-xray-event model directly.
    
    Args:
        model_api_url: API URL for the model
        prompt: User prompt/question
        event_list: Event data
        max_new_tokens: Maximum tokens for response
        temperature: Sampling temperature for model
        
    Returns:
        Analysis result from the specialized event model
    """
    try:
        print(f"DEBUG: Calling event analysis with prompt: '{prompt}'")
        
        # Call the qwen-7b-raw-xray-event model
        result, _ = await generate_response(
            base_url=model_api_url,
            prompt=prompt.strip(),
            history=[],
            event_list=event_list,
            max_new_tokens=max_new_tokens,
            temperature=temperature
        )
        
        print(f"DEBUG: Event analysis response: {result[:200]}...")
        return result
    except Exception as e:
        error_msg = f"Error in event analysis: {str(e)}"
        print(f"DEBUG: Event analysis error: {error_msg}")
        return error_msg