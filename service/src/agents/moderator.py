"""
Simple Conversation Moderator agent.
"""

from typing import Dict, Any, List
from ..llm.openai_client import call_openai_api
from ..llm.models import resolve

class ConversationModerator:
    """
    Simple moderator agent that reviews analyses and provides synthesis.
    """
    
    def __init__(self):
        pass

    async def moderate_discussion(self, moderation_prompt: str, *, openai_model: str | None = None) -> str:
        """
        Moderate discussion between analyses.
        """
        full_prompt = moderation_prompt
        model = resolve(openai_model)
        try:
            response = await call_openai_api(
                prompt=full_prompt,
                temperature=0.3,
                max_tokens=20000,
                model=model
            )
            return response
        except Exception as e:
            return f"Moderation failed: {str(e)}"