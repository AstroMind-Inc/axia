"""
Energy-Time (dE-dt) map generator for transient detection and spectral evolution analysis.

Based on methods from Salvaggio et al. (2024) MNRAS 537, 931.
The dE-dt map reveals spectral evolution over time without binning artifacts.
"""

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.colors import LogNorm
import base64
from io import BytesIO
from typing import Dict, Any, Optional, Tuple, List
from src.core.logger import get_logger

logger = get_logger(__name__)


def extract_event_data(data_obj: Dict[str, Any]) -> Tuple[np.ndarray, np.ndarray]:
    """
    Extract time and energy from event list.
    
    Args:
        data_obj: Data object containing event list
        
    Returns:
        times: Array of photon arrival times (seconds since observation start)
        energies: Array of photon energies (keV)
    """
    # Try original_event_list first (unpruned, full observation)
    event_list = data_obj.get('original_event_list') or data_obj.get('event_list')
    
    if not event_list or len(event_list) == 0:
        raise ValueError("No event data available for dE-dt map")
    
    events = np.array(event_list)
    
    logger.info(f"Event array shape: {events.shape}, dtype: {events.dtype}")
    
    # Check if we have a valid 2D array with at least 2 columns
    if events.ndim != 2 or events.shape[1] < 2:
        raise ValueError(f"Invalid event data structure: expected 2D array with >=2 columns, got shape {events.shape}")
    
    # Columns: [time, energy, ...]
    # Time is typically in column 0, energy in column 1
    times = events[:, 0]  # seconds since observation start
    energies_eV = events[:, 1]  # eV (electron volts)
    
    if len(times) == 0 or len(energies_eV) == 0:
        raise ValueError("Event arrays are empty after extraction")
    
    logger.info(f"Initial event count: {len(times)}, energy range: {energies_eV.min():.1f}-{energies_eV.max():.1f} eV")
    
    # Apply energy filter (500-7000 eV = 0.5-7.0 keV for Chandra)
    mask = (energies_eV >= 500) & (energies_eV <= 7000)
    times = times[mask]
    energies_eV = energies_eV[mask]
    
    logger.info(f"After energy filter: {len(times)} photons remaining (500-7000 eV range)")
    
    # Check if we have any photons left after filtering
    if len(times) == 0:
        raise ValueError("No photons in energy range 500-7000 eV for dE-dt map")
    
    # Convert energies to keV for plotting
    energies = energies_eV / 1000.0
    
    # Normalize time to start at 0
    times = times - times.min()
    
    # Sort by time
    sort_idx = np.argsort(times)
    times = times[sort_idx]
    energies = energies[sort_idx]
    
    logger.info(f"Extracted {len(times)} photons for dE-dt map (energy range: {energies.min():.2f}-{energies.max():.2f} keV)")
    
    return times, energies


def compute_de_dt_map(
    times: np.ndarray,
    energies: np.ndarray,
    t_bins: int = 24,
    E_bins: int = 16,
    E_min: float = 500.0,
    E_max: float = 7000.0,
    normalize: bool = True
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Compute E-t map using the method from Dillmann et al. (2024) MNRAS.
    
    This creates a 2D histogram showing normalized time (τ) vs log10 energy (ε),
    optimized for sparse event data in X-ray transient analysis.
    
    Reference: https://github.com/StevenDillmann/ml-xraytransients-mnras
    
    Args:
        times: Photon arrival times (s)
        energies: Photon energies (keV)
        t_bins: Number of time bins (default: 24, from paper)
        E_bins: Number of energy bins (default: 16, from paper)
        E_min: Minimum energy in eV (default: 500 eV = 0.5 keV)
        E_max: Maximum energy in eV (default: 7000 eV = 7.0 keV)
        normalize: Apply min-max normalization to [0, 1]
        
    Returns:
        et_map: 2D histogram (t_bins x E_bins), normalized to [0, 1] if normalize=True
        tau_edges: Normalized time bin edges [0, 1]
        eps_edges: Log10 energy bin edges [log10(E_min), log10(E_max)]
    """
    
    # Convert energies from keV to eV for consistency with paper
    E_array = energies * 1000.0  # keV -> eV
    
    # Normalize time to τ ∈ [0, 1]
    tau_array = (times - times.min()) / (times.max() - times.min())
    
    # Take log10 of energies: ε = log10(E)
    eps_array = np.log10(E_array)
    
    logger.info(f"Creating E-t map: {len(times)} photons, {t_bins}×{E_bins} bins")
    logger.info(f"  τ range: [0, 1], ε range: [{np.log10(E_min):.2f}, {np.log10(E_max):.2f}]")
    
    # Create E-t map using 2D histogram
    # Note: histogram2d(x, y) creates histogram with x on horizontal, y on vertical
    histogram, tau_edges, eps_edges = np.histogram2d(
        tau_array, 
        eps_array, 
        range=[[0, 1], [np.log10(E_min), np.log10(E_max)]], 
        bins=(t_bins, E_bins)
    )
    
    logger.info(f"E-t map created: shape={histogram.shape}, counts range: [{histogram.min():.0f}, {histogram.max():.0f}]")
    
    # Apply min-max normalization to [0, 1]
    if normalize:
        hist_min = np.min(histogram)
        hist_max = np.max(histogram)
        if hist_max > hist_min:
            et_map = (histogram - hist_min) / (hist_max - hist_min)
            logger.info(f"Normalized E-t map to [0, 1]")
        else:
            et_map = histogram
            logger.warning("Cannot normalize: all values are identical")
    else:
        et_map = histogram
    
    return et_map, tau_edges, eps_edges


def detect_transient_features(
    count_rate_2d: np.ndarray,
    time_edges: np.ndarray,
    energy_edges: np.ndarray,
    threshold_sigma: float = 5.0
) -> Dict[str, Any]:
    """
    Detect transient features in dE-dt map using statistical analysis.
    
    Args:
        count_rate_2d: 2D count rate map
        time_edges: Time bin edges
        energy_edges: Energy bin edges
        threshold_sigma: Detection threshold in standard deviations
        
    Returns:
        Dictionary with detected features:
        - flares: List of detected flare events
        - spectral_transitions: Hardness/softness changes
        - background_rate: Median background rate
        - variability_amplitude: Fractional variability
    """
    
    # Compute background rate (median, ignoring NaNs)
    bg_rate = np.nanmedian(count_rate_2d)
    bg_std = np.nanstd(count_rate_2d)
    
    if bg_rate == 0 or not np.isfinite(bg_rate):
        logger.warning("Cannot compute transient features: insufficient data")
        return {
            'flares': [],
            'spectral_transitions': [],
            'background_rate': 0,
            'variability_amplitude': 0
        }
    
    # Detect flares (>threshold_sigma above background)
    flare_mask = count_rate_2d > (bg_rate + threshold_sigma * bg_std)
    
    flares = []
    if np.any(flare_mask):
        try:
            # Find connected regions (flare events)
            from scipy import ndimage
            labeled, n_features = ndimage.label(flare_mask)
            
            for i in range(1, n_features + 1):
                flare_region = (labeled == i)
                energy_idx, time_idx = np.where(flare_region)
                
                # Require at least 3 connected pixels to be a real flare (not just noise)
                if len(time_idx) >= 3:
                    t_start = time_edges[time_idx.min()]
                    t_end = time_edges[time_idx.max() + 1]
                    e_mean = np.mean((energy_edges[energy_idx] + energy_edges[energy_idx + 1]) / 2)
                    peak_rate = np.nanmax(count_rate_2d[flare_region])
                    
                    flares.append({
                        'time_range': (float(t_start), float(t_end)),
                        'duration': float(t_end - t_start),
                        'mean_energy': float(e_mean),
                        'peak_rate': float(peak_rate),
                        'significance': float((peak_rate - bg_rate) / bg_std)
                    })
        except ImportError:
            logger.warning("scipy not available for flare detection")
    
    # Detect spectral transitions (hardness changes over time)
    soft_band_mask = (energy_edges[:-1] >= 0.5) & (energy_edges[:-1] < 2.0)
    hard_band_mask = (energy_edges[:-1] >= 2.0) & (energy_edges[:-1] <= 7.0)
    
    soft_counts = np.nansum(count_rate_2d[soft_band_mask, :], axis=0)
    hard_counts = np.nansum(count_rate_2d[hard_band_mask, :], axis=0)
    
    with np.errstate(divide='ignore', invalid='ignore'):
        hardness_ratio = (hard_counts - soft_counts) / (hard_counts + soft_counts + 1e-10)
    
    # Detect transitions (large variations in hardness)
    transitions = []
    for i in range(1, len(hardness_ratio)):
        if np.isfinite(hardness_ratio[i]) and np.isfinite(hardness_ratio[i-1]):
            hr_change = hardness_ratio[i] - hardness_ratio[i-1]
            if abs(hr_change) > 0.5:
                transitions.append({
                    'time': float(time_edges[i]),
                    'hardness_change': float(hr_change),
                    'type': 'hardening' if hr_change > 0 else 'softening'
                })
    
    # Compute variability amplitude with Poisson noise correction
    # For Poisson statistics, intrinsic_var^2 = observed_var^2 - Poisson_var^2
    # where Poisson_var ≈ sqrt(mean_rate)
    poisson_std = np.sqrt(bg_rate) if bg_rate > 0 else 0
    intrinsic_var_squared = max(0, bg_std**2 - poisson_std**2)
    variability_amplitude = np.sqrt(intrinsic_var_squared) / bg_rate if bg_rate > 0 else 0
    
    logger.info(f"Detected {len(flares)} flares and {len(transitions)} spectral transitions (var_amp: {variability_amplitude:.3f})")
    
    return {
        'flares': flares,
        'spectral_transitions': transitions,
        'background_rate': float(bg_rate),
        'variability_amplitude': float(variability_amplitude)
    }


def create_de_dt_plot(
    et_map: np.ndarray,
    tau_edges: np.ndarray,
    eps_edges: np.ndarray,
    data_obj: Dict[str, Any],
    E_min: float = 500.0,
    E_max: float = 7000.0
) -> Optional[str]:
    """
    Create E-t map visualization using the method from Dillmann et al. (2024) MNRAS.
    
    Args:
        et_map: 2D histogram (t_bins x E_bins), normalized [0, 1]
        tau_edges: Normalized time bin edges [0, 1]
        eps_edges: Log10 energy bin edges
        data_obj: Data object with source metadata
        E_min: Minimum energy in eV (for axis labels)
        E_max: Maximum energy in eV (for axis labels)
        
    Returns:
        Base64-encoded PNG image
    """
    
    try:
        # Create figure with light background (matches paper style)
        fig, ax = plt.subplots(figsize=(10, 6), dpi=100, facecolor='white')
        ax.set_facecolor('white')
        
        # Apply threshold to hide very low counts (noise reduction)
        # Set counts below 10% of max to NaN (will appear as white)
        et_map_display = et_map.T.copy()
        threshold = 0.1  # 10% of normalized range
        et_map_display[et_map_display < threshold] = np.nan
        
        # Use YlGn (Yellow-Green) colormap: white/cream → yellow → green → dark green
        # This matches the paper's aesthetic where sparse regions fade to white
        from matplotlib.colors import LinearSegmentedColormap
        
        # Create custom colormap: white → light green → dark green
        colors = ['#FFFFFF', '#F7FCF5', '#E5F5E0', '#C7E9C0', '#A1D99B', 
                  '#74C476', '#41AB5D', '#238B45', '#006D2C', '#00441B']
        n_bins = 256
        cmap = LinearSegmentedColormap.from_list('paper_green', colors, N=n_bins)
        
        # Use imshow for clean visualization (matches paper's implementation)
        # Transpose to get correct orientation: τ on x-axis, ε on y-axis
        im = ax.imshow(
            et_map_display,
            origin='lower',
            aspect='auto',
            extent=[0, 1, np.log10(E_min), np.log10(E_max)],
            cmap=cmap,
            interpolation='nearest'
        )
        
        # Colorbar (hide NaN values in colorbar label)
        cbar = plt.colorbar(im, ax=ax, label='Normalized Count Rate')
        cbar.ax.tick_params(labelsize=10, colors='black')
        
        # Labels using paper's notation: τ (tau) and ε (epsilon)
        ax.set_xlabel(r'$\tau$', fontsize=14, fontweight='bold', color='black')
        ax.set_ylabel(r'$\epsilon$', fontsize=14, fontweight='bold', color='black')
        
        # Style axes for light background
        ax.tick_params(axis='both', which='major', labelsize=10, colors='black')
        ax.spines['bottom'].set_color('black')
        ax.spines['left'].set_color('black')
        ax.spines['top'].set_color('black')
        ax.spines['right'].set_color('black')
        
        # Add energy scale labels on right y-axis for readability
        ax2 = ax.twinx()
        ax2.set_ylabel('Energy (keV)', fontsize=10, color='#555555')
        ax2.set_ylim(np.log10(E_min), np.log10(E_max))
        
        # Set energy ticks: 0.5, 1, 2, 4, 7 keV
        energy_keV_ticks = [0.5, 1.0, 2.0, 4.0, 7.0]
        energy_eV_ticks = [e * 1000 for e in energy_keV_ticks]
        eps_ticks = [np.log10(e) for e in energy_eV_ticks]
        ax2.set_yticks(eps_ticks)
        ax2.set_yticklabels([f'{e:.1f}' for e in energy_keV_ticks], color='#555555', fontsize=9)
        ax2.tick_params(axis='y', colors='#555555')
        
        # Add horizontal line at 2 keV (soft/hard boundary) - subtle gray line
        eps_2keV = np.log10(2000)
        ax.axhline(y=eps_2keV, color='gray', linestyle='--', alpha=0.3, linewidth=1)
        
        # Title with source info
        source_name = data_obj.get('source_name', 'Unknown')
        obsid = data_obj.get('obsid', 'N/A')
        ax.set_title(
            f'Energy-Time Map (E-t)\n{source_name} (ObsID: {obsid})',
            fontsize=13,
            fontweight='bold',
            pad=10,
            color='black'
        )
        
        # Grid - light gray for clean look
        ax.grid(True, alpha=0.15, linestyle='--', linewidth=0.5, color='gray')
        
        plt.tight_layout()
        
        # Convert to base64
        buffer = BytesIO()
        plt.savefig(buffer, format='png', dpi=100, bbox_inches='tight')
        buffer.seek(0)
        image_base64 = base64.b64encode(buffer.read()).decode('utf-8')
        plt.close(fig)
        
        logger.info("E-t map visualization created successfully")
        return image_base64
        
    except Exception as e:
        logger.error(f"Failed to create E-t plot: {e}", exc_info=True)
        plt.close('all')
        return None


def create_de_dt_image(data_obj: Dict[str, Any]) -> Optional[str]:
    """
    Main entry point: Create E-t map image from data object using Dillmann et al. (2024) method.
    
    Args:
        data_obj: Data object containing event list
        
    Returns:
        Base64-encoded PNG image, or None if generation fails
    """
    try:
        # Extract event data
        times, energies = extract_event_data(data_obj)
        
        if len(times) < 10:
            logger.warning(f"Too few photons ({len(times)}) for meaningful E-t map")
            return None
        
        # Compute E-t map using paper's method
        E_min = 500.0  # eV
        E_max = 7000.0  # eV
        et_map, tau_edges, eps_edges = compute_de_dt_map(
            times, energies,
            t_bins=24,
            E_bins=16,
            E_min=E_min,
            E_max=E_max,
            normalize=True
        )
        
        # Create visualization
        et_image = create_de_dt_plot(
            et_map, tau_edges, eps_edges, data_obj,
            E_min=E_min, E_max=E_max
        )
        
        return et_image
        
    except Exception as e:
        logger.warning(f"Failed to generate E-t map: {e}")
        return None

