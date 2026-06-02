"""
Critic agent for reviewing astrophysics analyses and pointing out inconsistencies.
"""

from typing import Dict, Any, List
from ..llm.openai_client import call_openai_api

class CriticAgent:
    """
    Critic agent that reviews analyses from other agents and points out:
    - Inconsistencies between different analyses
    - Missing checks or considerations
    - Overinterpretation of data
    - Alternative explanations
    - Statistical concerns
    """
    
    def __init__(self):
        
        # Astrophysics-specific review checklist
        self.review_checklist = [
            "Statistical significance of claimed detections",
            "Consistency between spectral and timing analyses",
            "Proper treatment of systematic uncertainties",
            "Alternative model explanations considered",
            "Instrumental effects and calibration issues",
            "Source confusion or background contamination",
            "Energy-dependent systematic effects",
            "Off-axis angle and PSF considerations",
            "Pile-up effects for bright sources",
            "Temporal variability vs. statistical fluctuations"
        ]
        
        self.system_prompt = f"""You are a senior astrophysics reviewer with expertise in X-ray astronomy and Chandra Observatory data analysis.

Your role is to critically evaluate analyses and conclusions, looking for:

SCIENTIFIC RIGOR:
- Are claims properly supported by evidence?
- Are statistical significances calculated correctly?
- Are systematic uncertainties acknowledged?
- Are alternative explanations considered?

TECHNICAL ISSUES:
- Instrumental effects (PSF, pile-up, background)
- Calibration and energy response issues
- Source confusion or contamination
- Off-axis angle effects on data quality

DATA INTERPRETATION:
- Overinterpretation of marginal signals
- Cherry-picking or confirmation bias
- Proper error propagation
- Model selection criteria

You are given analysis from two different agents. One is looking at the metadata and other is looking into the raw event data. 
One looking into the raw event data always gives direct answer to the question. This will not provide any reasoning for its answer. Also it is not correct most of the times.
You have to critically evaluate the answer from the event analysis and the metadata analysis.



COMMON PITFALLS:
{chr(10).join(f"- {item}" for item in self.review_checklist)}

Be constructive but thorough. Point out specific concerns and suggest additional checks or alternative approaches.
If analyses appear sound, say so clearly. Your goal is to improve the science, not just find problems."""

    async def review_analyses(self, review_prompt: str, *, openai_model: str = "gpt-5-mini") -> str:
        """
        Review analyses and provide critical assessment.
        """
        full_prompt = f"{self.system_prompt}\n\n{review_prompt}"
        model = openai_model 
        if (model == "gpt-5") or (model == "gpt-5-mini") or (model == "gpt-5-nano"):
            temperature = 1.0
        else:
            temperature = 0.7
        try:
            response = await call_openai_api(
                prompt=full_prompt,
                temperature=temperature,
                max_tokens=20000,
                model=model
            )
            return response
        except Exception as e:
            return f"Critic review failed: {str(e)}"
    
