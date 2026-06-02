"""
Simple multi-agent workflow entry point.
"""

from typing import Dict, Any, List, Tuple
from .workflow import SimpleWorkflow
from ..api.models import ChatMessage

async def generate_multi_agent_response(
    user_message: str,
    data_obj: Dict[str, Any],
    history: List[ChatMessage],
    event_list: List[List[float]],
    model_api_url: str,
    neighbors: List[Dict[str, Any]] = None,
    openai_model: str | None = None,
    response_format: str | None = None,
    max_steps: int = 8,
    max_tool_calls: int = 6,
    enable_tools: bool = True,
    agent_config: Dict[str, bool] = None
):
    """
    Generate streaming response using simple multi-agent workflow.
    
    Simple workflow with streaming:
    1. Call event analysis directly with exact user prompt
    2. Call metadata analysis directly with exact user prompt
    3. Call neighbor analysis if neighbors provided
    4. Pass results to critic and moderator
    5. (Optional) Tool agent for dynamic research
    6. Final moderation and synthesis
    
    Args:
        user_message: User's question or prompt
        data_obj: Complete data object from MongoDB
        history: Chat history as ChatMessage objects
        event_list: List of event data for specialized analysis
        model_api_url: API URL for the qwen-7b-raw-xray-event model
        neighbors: List of nearest neighbor objects for comparative analysis
        enable_tools: Whether to enable tool agent (default: True)
        max_steps: Not used in simple workflow (kept for compatibility)
        max_tool_calls: Not used in simple workflow (kept for compatibility)
        
    Yields:
        Dict containing progress updates and results from each agent
    """
    simple_workflow = SimpleWorkflow(
        model_api_url,
        openai_model=openai_model,
        enable_tools=enable_tools,
    )
    
    # Stream the workflow results
    async for update in simple_workflow.run_simple_workflow(
        user_message=user_message,
        data_obj=data_obj,
        history=history,
        event_list=event_list,
        neighbors=neighbors,
        response_format=response_format,
        agent_config=agent_config
    ):
        yield update