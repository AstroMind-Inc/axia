"""
Object details controller for enhanced object information processing.
"""

from fastapi import APIRouter
from typing import Dict, Any

from src.api.models import ObjectDetailsRequest, ObjectDetailsResponse, LightCurveData
from src.core.logger import get_logger
from src.spectrum.snapshot import make_spectrum_snapshot, create_light_curve_data, create_time_light_curve_data, create_gl_light_curve_data, render_spectrum_text
from src.spectrum.de_dt_map import create_de_dt_image

router = APIRouter()
logger = get_logger(__name__)


@router.post("/object-details-enhanced", response_model=ObjectDetailsResponse)
async def process_object_details_enhanced(request: ObjectDetailsRequest):
    """
    Process object data to generate enhanced details including light curve and spectrum analysis.
    
    Args:
        request: Object details request with the full object_data
        
    Returns:
        Enhanced object details with light curve data
    """
    try:
        obj_data = request.object_data
        obj_id = obj_data.get('_id', 'unknown')
        
        # Log event list size for diagnostics
        event_list = obj_data.get('event_list', [])
        original_event_list = obj_data.get('original_event_list', [])
        event_count = len(original_event_list) if original_event_list else len(event_list)
        
        logger.info(f"🔍 Processing enhanced details for object: {obj_id}")
        logger.info(f"📊 Event count: {event_count} events")
        
        # Generate spectrum snapshot
        spectrum_snapshot = None
        light_curve_data = None
        time_light_curve = None
        gl_light_curve = None
        spectrum_text = None
        de_dt_map = None
        
        try:
            # Step 1: Create comprehensive spectrum analysis
            logger.info(f"⏱️  Step 1/5: Starting make_spectrum_snapshot (events: {event_count})")
            import time
            start_time = time.time()
            spectrum_snapshot = make_spectrum_snapshot(obj_data)
            elapsed = time.time() - start_time
            logger.info(f"✅ Step 1/5: make_spectrum_snapshot completed in {elapsed:.2f}s")
            
            # Step 2: Render spectrum text
            logger.info(f"⏱️  Step 2/5: Starting render_spectrum_text")
            start_time = time.time()
            try:
                spectrum_text = render_spectrum_text(spectrum_snapshot)
                elapsed = time.time() - start_time
                logger.info(f"✅ Step 2/5: render_spectrum_text completed in {elapsed:.2f}s")
            except Exception as e:
                elapsed = time.time() - start_time
                logger.error(f"❌ Step 2/5: render_spectrum_text failed after {elapsed:.2f}s: {str(e)}")
                spectrum_text = None
            
            # Step 3: Create energy spectrum data
            logger.info(f"⏱️  Step 3/5: Starting create_light_curve_data")
            start_time = time.time()
            light_curve_raw = create_light_curve_data(obj_data)
            elapsed = time.time() - start_time
            
            if "error" not in light_curve_raw:
                light_curve_data = LightCurveData(**light_curve_raw)
                logger.info(f"✅ Step 3/5: create_light_curve_data completed in {elapsed:.2f}s ({light_curve_data.total_events} events)")
            else:
                logger.warning(f"⚠️  Step 3/5: create_light_curve_data failed after {elapsed:.2f}s: {light_curve_raw['error']}")

            # Step 4: Create time light curve (counts vs time)
            logger.info(f"⏱️  Step 4/5: Starting create_time_light_curve_data")
            start_time = time.time()
            try:
                time_light_curve = create_time_light_curve_data(obj_data, bin_size_s=500)
                elapsed = time.time() - start_time
                logger.info(f"✅ Step 4/5: create_time_light_curve_data completed in {elapsed:.2f}s")
            except Exception as e:
                elapsed = time.time() - start_time
                logger.error(f"❌ Step 4/5: create_time_light_curve_data failed after {elapsed:.2f}s: {str(e)}")
                
            # Step 5: Create GL step light curve
            logger.info(f"⏱️  Step 5/6: Starting create_gl_light_curve_data")
            start_time = time.time()
            try:
                gl_light_curve = create_gl_light_curve_data(obj_data)
                elapsed = time.time() - start_time
                logger.info(f"✅ Step 5/6: create_gl_light_curve_data completed in {elapsed:.2f}s")
            except Exception as e:
                elapsed = time.time() - start_time
                logger.error(f"❌ Step 5/6: create_gl_light_curve_data failed after {elapsed:.2f}s: {str(e)}")
            
            # Step 6: Create dE-dt map (energy-time 2D map)
            logger.info(f"⏱️  Step 6/6: Starting create_de_dt_image")
            start_time = time.time()
            try:
                de_dt_map = create_de_dt_image(obj_data)
                elapsed = time.time() - start_time
                if de_dt_map:
                    logger.info(f"✅ Step 6/6: create_de_dt_image completed in {elapsed:.2f}s")
                else:
                    logger.warning(f"⚠️  Step 6/6: create_de_dt_image returned None after {elapsed:.2f}s")
            except Exception as e:
                elapsed = time.time() - start_time
                logger.error(f"❌ Step 6/6: create_de_dt_image failed after {elapsed:.2f}s: {str(e)}")
                
        except Exception as e:
            logger.error(f"❌ Spectrum processing failed: {str(e)}", exc_info=True)
            # Continue without spectrum data rather than failing completely
        
        return ObjectDetailsResponse(
            success=True,
            object_data=obj_data,
            light_curve=light_curve_data,
            spectrum_snapshot=spectrum_snapshot,
            spectrum_text=spectrum_text,
            time_light_curve=time_light_curve,
            gl_light_curve=gl_light_curve,
            de_dt_map=de_dt_map
        )
        
    except Exception as e:
        logger.error(f"Error processing enhanced object details: {str(e)}")
        return ObjectDetailsResponse(
            success=False,
            error=f"Failed to process object details: {str(e)}"
        )