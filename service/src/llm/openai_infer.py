from typing import Dict, Any, List, Tuple, Optional
import math

from src.api.models import ChatMessage
from src.core.logger import get_logger
from src.spectrum.snapshot import make_spectrum_snapshot, render_spectrum_text, create_light_curve_image
from src.spectrum.de_dt_map import create_de_dt_image
from .openai_client import call_openai_api

logger = get_logger(__name__)


def format_chandra_observation_prompt(
    user_message: str,
    data_obj: Dict[str, Any],
    history: List[ChatMessage],
    has_light_curve_image: bool = False,
    has_de_dt_image: bool = False
) -> str:
    """
    Format a comprehensive prompt for OpenAI API using processed Chandra X-ray Observatory data.
    
    Args:
        user_message: The user's question
        data_obj: Complete MongoDB document from Chandra observation
        history: Chat conversation history
        has_light_curve_image: Whether a light curve image is included
        has_de_dt_image: Whether an energy-time (dE-dt) map is included
        
    Returns:
        Formatted prompt string for OpenAI with detailed astrophysical context
    """
    
    # Process the raw data into a spectrum snapshot
    try:
        spectrum_snapshot = make_spectrum_snapshot(data_obj)
    except Exception as e:
        logger.error(f"Error processing spectrum snapshot: {e}")
        spectrum_snapshot = {"error": f"Could not process spectrum data: {e}"}
    
    # Format conversation history
    conversation_context = ""
    if history:
        conversation_context = "\n\nPrevious Conversation:\n"
        for msg in history[-3:]:  # Last 3 messages for context
            conversation_context += f"{msg.role.title()}: {msg.content}\n"
    
    # Format the processed spectrum analysis
    spectrum_analysis = render_spectrum_text(spectrum_snapshot)
    
    # Add note about visual data if available
    visual_data_note = ""
    if has_light_curve_image or has_de_dt_image:
        visual_data_note = "\n\nVISUAL DATA:\n========================== You are providedd with below images."
        
        if has_light_curve_image:
            visual_data_note += "\n\n1. LIGHT CURVE (Count Rate vs. Time):\nA traditional binned light curve showing count rate evolution over time. This plot includes error bars (Poisson statistics) and key statistics (mean rate, standard deviation, fractional RMS variability, number of bins, total duration). Use this to assess overall temporal variability patterns, identify sustained dips, flares or quiescence periods, and estimate characteristic timescales."
        
        if has_de_dt_image:
            visual_data_note += (
                "\n\n2. ENERGY-TIME MAP (dE-dt Map):\n"
                "A 2D histogram of normalized time (τ, horizontal axis) versus log10 energy ε (vertical axis), with a secondary keV scale. "
                "Colors run from pale to dark green to show relative count-rate density; lighter columns mark dips while darker stripes highlight flares. "
                "A faint dashed line at 2 keV separates the soft and hard bands.\n"
                "Use this map to:\n"
                "- Compare bright vertical bands (flares) and pale gaps (dips) to judge how variability depends on energy.\n"
                "- Note horizontal bands for persistent emission and diagonal trends for spectral hardening or softening.\n"
                "- Cross-check timing against the light curve to confirm when and in which energy range key changes occur."
            )
        
        visual_data_note += "\n\nUse both plots together: The light curve provides statistical summary, while the dE-dt map reveals spectral details and transient features without binning biases.\n"
    
    # Create comprehensive prompt with interpretation guidelines
    prompt = f"""You are an expert X-ray astronomer specializing in Chandra X-ray Observatory data analysis. You have access to a detailed spectral analysis of a single astronomical source. Use your astrophysical knowledge along with the provided data to answer the user's question along the conversation it is having with LLms.


CHANDRA X-RAY SOURCE DATA:
==========================

USER QUESTION: {user_message}


PROCESSED SPECTRAL ANALYSIS:
{spectrum_analysis}
{visual_data_note}
Conversation History for context:
{conversation_context}


INSTRUCTIONS:
1. Give the direct answer to the user's question with your astrophysical knowledge with all possible options with a mention on the likeliness.
2. Tell what information you have used to answer the question.
3. Tell whether the recieved metadata directly mentioned the answer to the user's question or you had to infer it from the data.
4. Further analysis on What the spectral fits and spectral lines tell us about the source physics and how that lead to your answer
4. Further analysis on whether there are contradicting properties to your answer.
5. Further analysis on Any interesting or unusual characteristics.
6. Comment on the event count or any other factors to say whether it is enough information to come to the answer you provided.
6. Further analysis on Confidence level in the analysis based on detection significance and fit quality. 


Be scientifically rigorous, cite specific parameter values, and explain the physical interpretation. Use the guidelines as context but rely primarily on your astrophysical knowledge."""

    return prompt


async def generate_openai_response(
    user_message: str,
    data_obj: Dict[str, Any],
    history: List[ChatMessage],
    *,
    openai_model: str = "gpt-5-mini",
    max_tokens: int = 10000,
    temperature: float = 0.3
) -> Tuple[str, str]:
    """
    Generate a response using OpenAI's gpt-4.1-mini model with Chandra observation data.
    Automatically includes light curve image for vision-capable models.
    
    Args:
        user_message: The user's question
        data_obj: Complete MongoDB document from observation
        history: Chat conversation history
        max_tokens: Maximum tokens to generate
        temperature: Temperature for response generation
        
    Returns:
        Tuple of (response_text, formatted_prompt)
    """
    try:
        # Generate light curve image for vision models
        light_curve_image = None
        try:
            light_curve_image = create_light_curve_image(data_obj)
            if light_curve_image:
                logger.info("✅ Generated light curve image for LLM vision analysis")
            else:
                logger.info("⚠️ Light curve image generation skipped (insufficient data)")
        except Exception as e:
            logger.warning(f"⚠️ Failed to generate light curve image: {e}")
        
        # Generate dE-dt map for vision models
        de_dt_image = None
        try:
            de_dt_image = create_de_dt_image(data_obj)
            if de_dt_image:
                logger.info("✅ Generated dE-dt map for LLM vision analysis")
            else:
                logger.info("⚠️ dE-dt map generation skipped (insufficient data)")
        except Exception as e:
            logger.warning(f"⚠️ Failed to generate dE-dt map: {e}")
        
        # Format the prompt with observation data
        formatted_prompt = format_chandra_observation_prompt(
            user_message, 
            data_obj, 
            history,
            has_light_curve_image=light_curve_image is not None,
            has_de_dt_image=de_dt_image is not None
        )
        
        logger.info("Calling OpenAI for Chandra observation analysis")
        model = openai_model
        if (model == "gpt-5") or (model == "gpt-5-mini") or (model == "gpt-5-nano"):
            temperature = 1.0
        else:
            temperature = 0.3        
        
        # Prepare images list with both light curve and dE-dt map
        images = []
        if light_curve_image:
            images.append(light_curve_image)
        if de_dt_image:
            images.append(de_dt_image)
        images = images if images else None
        
        # Use the utility function for the API call
        response_text = await call_openai_api(
            prompt=formatted_prompt,
            max_tokens=max_tokens,
            temperature=temperature,
            model=model,
            images=images
        )
        
        return response_text, formatted_prompt

    except Exception as e:
        logger.error(f"Error calling OpenAI API: {str(e)}")
        raise
