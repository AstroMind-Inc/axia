"""
Simple state for multi-agent workflow.
"""

from typing import List, Dict, Any, Optional
from typing_extensions import TypedDict
from ..api.models import ChatMessage

class SimpleWorkflowState(TypedDict):
    """Simple state for multi-agent workflow."""
    
    # Input data
    user_message: str
    data_obj: Dict[str, Any]
    event_list: Optional[List[List[float]]]
    neighbors: Optional[List[Dict[str, Any]]]
    original_history: List[ChatMessage]
    
    # Analysis results
    event_analysis_result: Optional[str]
    metadata_analysis_result: Optional[str]
    neighbor_analysis_result: Optional[str]
    critic_review: Optional[str]
    moderator_response: Optional[str]
    
    # Conversation tracking
    conversation_log: List[Dict[str, Any]]