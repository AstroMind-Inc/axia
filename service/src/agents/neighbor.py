"""
Neighbor Analysis Agent for comparing selected object with nearest neighbors.
"""

from typing import Dict, Any, List
from ..llm.openai_client import call_openai_api
from src.spectrum.snapshot import render_spectrum_text

class NeighborAnalysisAgent:
    """Agent that analyzes similarities between selected object and its nearest neighbors."""
    
    def __init__(self):
        self.agent_name = "NeighborAnalysisAgent"
    
    async def analyze_neighbors(
        self, 
        user_question: str,
        selected_object_spectrum: Dict[str, Any],
        neighbor_spectra: List[Dict[str, Any]],
        *,
        openai_model: str = "gpt-5-mini"
    ) -> str:
        """
        Analyze the selected object against its nearest neighbors to provide comparative insights.
        
        Args:
            user_question: The original user question
            selected_object_spectrum: Processed spectrum data for the selected object
            neighbor_spectra: List of processed spectrum data for nearest neighbors
            
        Returns:
            Comparative analysis result
        """
        try:
            # Create comprehensive analysis prompt
            prompt = self._create_analysis_prompt(
                user_question, 
                selected_object_spectrum, 
                neighbor_spectra
            )
            model = openai_model 
            if (model == "gpt-5") or (model == "gpt-5-mini") or (model == "gpt-5-nano"):
                temperature = 1.0
            else:
                temperature = 0.3
            # Generate analysis using direct OpenAI API call
            result = await call_openai_api(
                prompt=prompt,
                temperature=temperature,
                max_tokens=20000,
                model=model
            )
            
            return result
            
        except Exception as e:
            return f"Neighbor analysis failed: {str(e)}"
    
    def _create_analysis_prompt(
        self, 
        user_question: str,
        selected_object_spectrum: Dict[str, Any],
        neighbor_spectra: List[Dict[str, Any]]
    ) -> str:
        """Create detailed analysis prompt for neighbor comparison."""
        
        prompt = f"""
You are an expert astrophysicist analyzing X-ray sources from Chandra X-ray Observatory. 

You are given details taken from the xray spectrum from Chandra observatory, of a astrophysical object with details from 10 similar objects from our embedding space based on cosine similarity.  

Your job is to compare the spectral and other characteristics and their spectral histogram and figure out the most similar items from the list of neighbors. 

Then using those similar items, try to answer the question: {user_question}

SELECTED OBJECT ANALYSIS:
{render_spectrum_text(selected_object_spectrum)}

NEAREST NEIGHBORS ANALYSIS:
"""
        
        for i, neighbor in enumerate(neighbor_spectra, 1):
            prompt += f"\nNeighbor {i}:\n Similarity score: {neighbor.get('similarity_score')}\n"
            if neighbor.get("source_type") != "X" :
                prompt += f"Source type: {neighbor.get('source_type')}\n "
            if neighbor.get("source_type_category") != "Other":
                prompt += f"Source type category: {neighbor.get('source_type_category')}\n"
            prompt += render_spectrum_text(neighbor)
            prompt += "\n" + "="*50 + "\n"
        
        prompt += f"""


COMPARATIVE ANALYSIS TASK:
1. Compare the selected object's spectral properties including the spectral regions with its nearest neighbors and figure out the most similar neighbors.
2. Using the most similar neighbors, provide insights relevant to the question: {user_question} as the first thing.
3. If there are multiple possible answers, mention them all with comment and reasoning on how probable of being correct each is. 
4. Then do a discussion with your astronomy knowledge to interpret how these similar objects can answer the above question and based on these similarities, whether these neighbors can be actually used to interpret the original object. Explain it in astrophysics context using the spectral properties.
5. Clearly mention which neighbors you selected andyour reasoning for selecting those neighbors and the reasoning behind the answer.
6. At the end, mention your confidence level on the answer. You can look at the similarity score and the spectral property similarities you used to find the nearest neighbors and whether the details in those neighbors had answers to the question.
7. At the end give a conclusion of this providing scientific insight.
"""
        
        return prompt
    
    def _format_spectrum_data(self, spectrum_data: Dict[str, Any], object_name: str) -> str:
        """Format spectrum data for prompt inclusion."""
        
        if not spectrum_data:
            return f"{object_name}: No spectrum data available"
        
        formatted = f"{object_name} Spectrum Analysis:\n"
        
        # Basic properties
        if 'total_event_count' in spectrum_data:
            formatted += f"- Total Events: {spectrum_data['total_event_count']}\n"
        
        if 'flux_sig' in spectrum_data:
            formatted += f"- Flux Significance: {spectrum_data['flux_sig']} ({spectrum_data.get('flux_sig_category', 'unknown')})\n"
        
        if 'variability' in spectrum_data:
            formatted += f"- Variability: {spectrum_data['variability']} ({spectrum_data.get('variability_category', 'unknown')})\n"
        
        # Hardness ratios
        if 'hardness' in spectrum_data:
            hardness = spectrum_data['hardness']
            formatted += "- Hardness Ratios:\n"
            for ratio, value in hardness.items():
                if value is not None:
                    category = spectrum_data.get('hardness_categories', {}).get(f"{ratio}_category", "unknown")
                    formatted += f"  * {ratio}: {value} ({category})\n"
        
        # Spectral models
        if 'preferred_models' in spectrum_data:
            models = spectrum_data['preferred_models']
            if models:
                formatted += f"- Preferred Models: {', '.join(models)}\n"
        
        if 'stats' in spectrum_data:
            formatted += "- Model Statistics:\n"
            stats = spectrum_data['stats']
            for model, stat in stats.items():
                if stat is not None:
                    formatted += f"  * {model}: {stat}\n"
        
        # Line detections
        if 'lines_keV' in spectrum_data:
            lines = spectrum_data['lines_keV']
            significant_lines = [(line, count) for line, count in lines.items() if count > 2]
            if significant_lines:
                formatted += "- Significant Line Detections:\n"
                for line, count in significant_lines:
                    formatted += f"  * {line}: {count} counts\n"
        
        return formatted