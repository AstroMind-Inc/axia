"""
Simple Conversation Moderator agent.
"""

from typing import Dict, Any, List
from ..llm.openai_client import call_openai_api

class ConversationModerator:
    """
    Simple moderator agent that reviews analyses and provides synthesis.
    """
    
    def __init__(self):
        pass

    async def moderate_discussion(self, moderation_prompt: str, *, openai_model: str = "gpt-5-mini") -> str:
        """
        Moderate discussion between analyses.
        """
        full_prompt = moderation_prompt
        model = openai_model 
        if (model == "gpt-5") or (model == "gpt-5-mini") or (model == "gpt-5-nano"):
            temperature = 1.0
        else:
            temperature = 0.3
        try:
            response = await call_openai_api(
                prompt=full_prompt,
                temperature=temperature,
                max_tokens=20000,
                model=model
            )
            return response
        except Exception as e:
            return f"Moderation failed: {str(e)}"