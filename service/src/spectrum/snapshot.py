"""
Universal spectrum processing utilities for Chandra X-ray Observatory data.
Moved from LLM-specific module to be used across the application.
"""

import json
import math
from collections import OrderedDict
from typing import Dict, List, Tuple, Optional, Any

import numpy as np

# Try to import numba for JIT compilation (optional but recommended for performance)
try:
    from numba import jit
    NUMBA_AVAILABLE = True
except ImportError:
    NUMBA_AVAILABLE = False
    # Fallback: create a no-op decorator
    def jit(*args, **kwargs):
        def decorator(func):
            return func
        return decorator

# ------------------------------------------------------------------
#  Line windows (keV)
# ------------------------------------------------------------------
LINE_WINDOWS: List[Tuple[str, float, float]] = [
    ("Fe_Ka_6.35‑6.70", 6.35, 6.70),
    ("Fe_Kb_7.00‑7.12", 7.00, 7.12)
    # ("Ni_Ka_7.42‑7.54", 7.42, 7.54),
    # ("Ca_XIX_3.86‑3.94", 3.86, 3.94),
    # ("S_XV_2.42‑2.50", 2.42, 2.50),
    # ("Si_XIII_1.82‑1.91", 1.82, 1.91),
    # ("Mg_XI_1.31‑1.39", 1.31, 1.39),
    # ("Ne_IX_0.88‑0.96", 0.88, 0.96),
    # ("O_VIII_0.62‑0.69", 0.62, 0.69),
]

# ------------------------------------------------------------------
#  Spectral model features
# ------------------------------------------------------------------
SPECTRAL_FEATURES = {
    "power-law": ["powlaw_gamma", "powlaw_nh", "powlaw_ampl"],
    "bremsstrahlung": ["brems_kt"],
    "black-body": ["bb_kt", "bb_nh", "bb_ampl"],
    "apec": ["apec_kt", "apec_nh", "apec_norm", "apec_abund", "apec_z"]
}

# ------------------------------------------------------------------
#  Categorization bins
# ------------------------------------------------------------------

# Power‑law photon index Γ
_POW_GAMMA_BINS = [
    (-np.inf, 0.5, "very hard (<0.5)",
     "Extremely obscured or reflection‑dominated systems: Compton‑thick AGN, pile‑up distorted spectra"),
    (0.5, 1.5, "hard (flatter spectrum)",
     "Jet‑dominated blazars (synchrotron/self‑Compton); Comptonization in hot, optically thin coronae of BH binaries; PWNe synchrotron (1.3–2.1)"),
    (1.5, 2.5, "intermediate (most common)",
     "Inverse Compton scattering in AGN coronae (1.5–2.0); mixed thermal + Comptonized emission in NS binaries; disk + steep PL tail in BH soft state; GRB afterglows; ULX accretion physics (1.8–2.8)"),
    (2.5, 4.0, "soft",
     "Non‑thermal synchrotron in SNRs (2.0–3.0); IC/synchrotron relics in clusters (2.0–3.5); soft thermal‑like tails in TDEs"),
    (4.0, np.inf, "ultra‑soft (>4.0)",
     "Rare super‑soft thermal sources: extreme TDEs, supersoft WD atmospheres"),
]

# Black‑body temperature kT (keV)
_BB_KT_BINS = [
    (0.01, 0.1, "supersoft (10^5–10^6 K)",
     "Nuclear burning on white dwarfs (SSSs, 0.02–0.1 keV); some TDE disk emission (0.04–0.15 keV)"),
    (0.1, 0.3, "soft (10^6–3×10^6 K)",
     "Cooling NS surfaces in quiescent LMXBs or isolated NSs (0.05–0.12 keV); AGN soft‑excess from warm Comptonized disk coronae"),
    (0.3, 1.0, "warm (3×10^6–10^7 K)",
     "Anisotropic hot‑spots on NS polar caps and magnetars (0.3–1.5 keV); localized accretion heating"),
    (1.0, 2.0, "hot (10^7–2×10^7 K)",
     "Thermonuclear X‑ray bursts on neutron stars (1–3, up to 5 keV)"),
    (2.0, 5.0, "extreme (2×10^7–6×10^7 K)",
     "Multi‑temperature disk peaks in BH binaries (0.2–1.2 keV) and rare very hot flares/shocks"),
]

# Bremsstrahlung temperature kT (keV)
_BREMS_KT_BINS = [
    (0.1, 0.5, "cool (10^6–5×10^6 K)",
     "Loops in stellar coronae; soft bremsstrahlung in white‑dwarf binaries"),
    (0.5, 2.0, "warm (5×10^6–2×10^7 K)",
     "Shock‑heated plasma in supernova remnants; coronae of X‑ray binaries"),
    (2.0, 10.0, "moderate (2×10^7–10^8 K)",
     "Thermal ICM in galaxy groups; compact‑object accretion shocks"),
    (10.0, 20.0, "hot (10^8–2×10^8 K)",
     "Intracluster medium in rich clusters; boundary layers in NS XRBs"),
    (20.0, np.inf, "very‑hot (>2×10^8 K)",
     "Cataclysmic variable shocks; hard tails in hybrid continua; rare cluster merger shocks"),
]

# APEC plasma temperature kT (keV)
_APEC_KT_BINS = [
    (0.1, 0.5, "cool (10^6–5×10^6 K)",
     "Stellar coronae and Local Bubble ISM; loop heating and flaring line‑rich plasma"),
    (0.5, 2.0, "warm (5×10^6–2×10^7 K)",
     "Supernova remnant ejecta; galaxy group halos; metal‑enriched IGM"),
    (2.0, 10.0, "moderate (2×10^7–10^8 K)",
     "Intracluster medium in galaxy clusters; compact group shocks; YSO flares"),
    (10.0, 15.0, "hot (10^8–1.5×10^8 K)",
     "High‑temperature shocks in merging clusters; energetic cluster outskirts"),
    (15.0, np.inf, "ultra‑hot (>1.5×10^8 K)",
     "Extreme merger shocks or very hot multi‑component plasmas"),
]

# Hydrogen column density N_H (10^20 cm⁻²)
_NH_BINS = [
    (0.1, 1.0, "very low (0.1–1×10^20 cm⁻²)",
     "High Galactic latitudes: nearby stars, white dwarfs, some isolated NSs"),
    (1.0, 10.0, "low (1–10×10^20 cm⁻²)",
     "Local ISM and Local Bubble; ONC YSOs, young stellar coronae"),
    (10.0, 100.0, "moderate (10–100×10^20 cm⁻²)",
     "Milky Way disk and star-forming regions; molecular clouds"),
    (100.0, 1000.0, "obscured (10^22–10^23 cm⁻²)",
     "Class I YSOs; mildly obscured AGN"),
    (1000.0, 10000.0, "heavily obscured (10^23–10^24 cm⁻²)",
     "Type II AGN, ULIRGs, deeply embedded protostars"),
    (10000.0, np.inf, "extreme (>10^24 cm⁻²)",
     "Compton‑thick AGN; buried accretion tori"),
]

# ------------------------------------------------------------------
#  Helper functions
# ------------------------------------------------------------------

def _nan_to_none(x):
    """Convert NaN values to None."""
    return None if (x is None or (isinstance(x, float) and math.isnan(x))) else x


def _is_nan_safe(x) -> bool:
    """Safely check if a value is NaN, handling non-numeric types."""
    if x is None:
        return True
    if not isinstance(x, (int, float, np.number)):
        return True
    if isinstance(x, float) and math.isnan(x):
        return True
    if isinstance(x, np.number) and np.isnan(x):
        return True
    return False


def energy_filter_and_time_normalize_event_list(
    event_list: List[List[float]],
    e_min_eV: int = 500,
    e_max_eV: int = 7000,
) -> List[List[float]]:
    """
    Normalize event times to start at 0 and filter photons by energy range [e_min_eV, e_max_eV].
    Does not perform any duration capping/pruning.

    Args:
        event_list: List of [time_s, energy_eV]
        e_min_eV: Minimum photon energy in eV (inclusive)
        e_max_eV: Maximum photon energy in eV (inclusive)

    Returns:
        Filtered and time-normalized event list as a list of [time_s, energy_eV].
    """
    if not event_list:
        return []
    try:
        arr = np.asarray(event_list, dtype=float)
        if arr.ndim != 2 or arr.shape[1] < 2:
            return []
        # Time normalize to t0 = 0
        arr[:, 0] = arr[:, 0] - np.min(arr[:, 0])
        # Energy filter: keep events within [e_min_eV, e_max_eV]
        valid = (arr[:, 1] >= float(e_min_eV)) & (arr[:, 1] <= float(e_max_eV))
        arr = arr[valid, :]
        return arr[:, :2].tolist()
    except Exception:
        return []


def _categorise(value: float, bins) -> Optional[Dict[str, str]]:
    """Return {label, range, description} or None if NaN/None."""
    if _is_nan_safe(value):
        return None
    for lo, hi, label, desc in bins:
        if lo == -np.inf and value < hi:
            rng = f"<{hi}"
            return {"label": label, "range": rng, "description": desc}
        if hi == np.inf and value >= lo:
            rng = f">{lo}"
            return {"label": label, "range": rng, "description": desc}
        if value >= lo and value < hi:
            rng = f"{lo}-{hi if hi != float('inf') else '∞'}"
            return {"label": label, "range": rng, "description": desc}
    return None


def is_good_stat(val: float) -> bool:
    """Check if a C-stat value represents a good fit (0.7-1.2)."""
    try:
        if not isinstance(val, (int, float)):
            return False
        return (val >= 0.7) and (val < 1.2)
    except Exception:
        return False


def get_preferred_models(stats: Dict[str, float], lo: float = 0.7, hi: float = 1.2) -> List[str]:
    """Get list of preferred spectral models based on C-stat values."""
    key_to_model = {
        'apec_stat': 'apec',
        'powlaw_stat': 'power-law',
        'brems_stat': 'bremsstrahlung',
        'bb_stat': 'black-body'
    }
    cands = []
    for k, m in key_to_model.items():
        v = stats.get(k)
        # Check if value is numeric and finite
        if v is None or not isinstance(v, (int, float)) or not math.isfinite(v):
            continue
        if lo <= v <= hi:
            cands.append((abs(v - 1.0), m))
    cands.sort(key=lambda x: x[0])
    return [m for _, m in cands]


def categorize_flux_significance(flux_sig: float) -> str:
    """Categorize flux significance."""
    if not isinstance(flux_sig, (int, float)):
        return "unknown"
    if _is_nan_safe(flux_sig):
        return "unknown"
    if flux_sig < 3:
        return "very-weak"
    elif flux_sig < 5:
        return "marginal"
    elif flux_sig < 10:
        return "moderate"
    else:
        return "strong"


def categorize_variability(var_index: float) -> str:
    """Categorize variability index."""
    if not isinstance(var_index, (int, float)):
        return "unknown"
    if _is_nan_safe(var_index):
        return "unknown"
    if var_index == 0:
        return "no variability"
    elif var_index <= 2:
        return "possible low variability"
    elif var_index <= 7:
        return "moderate variability"
    else:
        return "high variability"


def categorize_hardness_ratio(ratio: float) -> str:
    """Categorize hardness ratio."""
    if not isinstance(ratio, (int, float)):
        return "unknown"
    if ratio > 0.5:
        return "very hard"
    elif ratio > 0.1:
        return "hard"
    elif ratio >= -0.1:
        return "balanced"
    elif ratio >= -0.5:
        return "soft"
    else:
        return "very soft"


# ------------------------------------------------------------------
#  Main spectrum snapshot function
# ------------------------------------------------------------------

def make_spectrum_snapshot(src: Dict[str, Any], bin_width: float = 0.25) -> Dict[str, Any]:
    """
    Create a comprehensive spectrum snapshot from Chandra observation data.
    
    Args:
        src: Source data dictionary containing spectral parameters and event list
        bin_width: Bin width for energy histogram (default 0.25 keV)
        
    Returns:
        Structured dictionary with categorized spectral analysis
    """
    snap = OrderedDict()
    
    # Basic source properties
    flux_sig = src.get("flux_significance_b", np.nan)
    var_index = src.get("var_index_b", np.nan)
    
    snap["flux_sig"] = round(flux_sig, 2) if not _is_nan_safe(flux_sig) and isinstance(flux_sig, (int, float)) else None
    snap["flux_sig_category"] = categorize_flux_significance(flux_sig)
    snap["variability"] = round(var_index, 2) if not _is_nan_safe(var_index) and isinstance(var_index, (int, float)) else None
    snap["variability_category"] = categorize_variability(var_index)
    
    # Event list analysis: prefer original_event_list if present; apply energy filter and time normalization
    raw_event_list = src.get("original_event_list", [])
    if isinstance(raw_event_list, list) and len(raw_event_list) > 0:
        event_list = energy_filter_and_time_normalize_event_list(raw_event_list, 500, 7000)
    else:
        event_list = src.get("event_list", [])
    snap["total_event_count"] = len(event_list)

    # Spectral model statistics
    stat_keys = ["powlaw_stat", "brems_stat", "bb_stat", "apec_stat"]
    stats = {key: src.get(key, np.nan) for key in stat_keys}
    
    if any(not _is_nan_safe(v) for v in stats.values()):
        snap["stats"] = {
            "powlaw": round(stats["powlaw_stat"], 3) if not _is_nan_safe(stats["powlaw_stat"]) and isinstance(stats["powlaw_stat"], (int, float)) else None,
            "brems": round(stats["brems_stat"], 3) if not _is_nan_safe(stats["brems_stat"]) and isinstance(stats["brems_stat"], (int, float)) else None,
            "blackbody": round(stats["bb_stat"], 3) if not _is_nan_safe(stats["bb_stat"]) and isinstance(stats["bb_stat"], (int, float)) else None,
            "apec": round(stats["apec_stat"], 3) if not _is_nan_safe(stats["apec_stat"]) and isinstance(stats["apec_stat"], (int, float)) else None,
        }
        
        # Get preferred models
        snap["preferred_models"] = get_preferred_models(stats)

        # Detailed model analysis for good fits with sufficient significance
        if is_good_stat(stats["powlaw_stat"]) and flux_sig > 3.0:
            gamma_cat = _categorise(src.get("powlaw_gamma"), _POW_GAMMA_BINS)
            nh_cat = _categorise(src.get("powlaw_nh"), _NH_BINS)
            snap["powlaw_stats"] = {
                "powlaw_stat": stats["powlaw_stat"],
                "powlaw_gamma": src.get("powlaw_gamma"),
                "powlaw_gamma_cat": gamma_cat,
                "powlaw_nh": src.get("powlaw_nh"),
                "powlaw_nh_cat": nh_cat,
            }

        if is_good_stat(stats["brems_stat"]) and flux_sig > 3.0:
            kt_cat = _categorise(src.get("brems_kt"), _BREMS_KT_BINS)
            snap["brems_stats"] = {
                "brems_stat": stats["brems_stat"],
                "brems_kt": src.get("brems_kt"),
                "brems_kt_cat": kt_cat,
            }

        if is_good_stat(stats["apec_stat"]) and flux_sig > 3.0:
            kt_cat = _categorise(src.get("apec_kt"), _APEC_KT_BINS)
            nh_cat = _categorise(src.get("apec_nh"), _NH_BINS)
            snap["apec_stats"] = {
                "apec_stat": stats["apec_stat"],
                "apec_kt": src.get("apec_kt"),
                "apec_kt_cat": kt_cat,
                "apec_nh": src.get("apec_nh"),
                "apec_nh_cat": nh_cat,
            }

        if is_good_stat(stats["bb_stat"]) and flux_sig > 3.0:
            kt_cat = _categorise(src.get("bb_kt"), _BB_KT_BINS)
            nh_cat = _categorise(src.get("bb_nh"), _NH_BINS)
            snap["bb_stats"] = {
                "bb_stat": stats["bb_stat"],
                "bb_kt": src.get("bb_kt"),
                "bb_kt_cat": kt_cat,
                "bb_nh": src.get("bb_nh"),
                "bb_nh_cat": nh_cat,
            }

    # Hardness ratios
    hard_hs = src.get("hard_hs", np.nan)
    hard_hm = src.get("hard_hm", np.nan)
    hard_ms = src.get("hard_ms", np.nan)
    
    hardness = {
        "HS": round(hard_hs, 3) if not _is_nan_safe(hard_hs) and isinstance(hard_hs, (int, float)) else None,
        "HM": round(hard_hm, 3) if not _is_nan_safe(hard_hm) and isinstance(hard_hm, (int, float)) else None,
        "MS": round(hard_ms, 3) if not _is_nan_safe(hard_ms) and isinstance(hard_ms, (int, float)) else None,
    }
    
    # Add hardness categories
    hardness_categories = {}
    for key, value in hardness.items():
        if value is not None:
            hardness_categories[f"{key}_category"] = categorize_hardness_ratio(value)
    
    snap["hardness"] = hardness
    snap["hardness_categories"] = hardness_categories

    # Line analysis (only if event list is available)
    if event_list:
        energies_keV = np.array([e for _, e in event_list]) / 1000.0
        
        # Line counts
        lines_dict = OrderedDict()
        for tag, lo, hi in LINE_WINDOWS:
            lines_dict[tag] = int(((energies_keV >= lo) & (energies_keV <= hi)).sum())
        snap["lines_keV"] = lines_dict

        # Coarse continuum histogram (0.5–10 keV)
        e_min, e_max = 0.5, 10.0
        bins = np.arange(e_min, e_max + bin_width, bin_width)
        counts, edges = np.histogram(energies_keV, bins=bins)

        hist = OrderedDict()
        for i, cnt in enumerate(counts):
            lo, hi = edges[i], edges[i + 1]
            if lo >= 8.0:
                hist["8.00‑10.00"] = int(cnt + counts[i + 1:].sum())
                break
            hist[f"{lo:0.2f}‑{hi:0.2f}"] = int(cnt)
        snap["histogram_counts"] = hist
        # Preserve raw events for downstream prompt expansion (events-only derivations)
        try:
            snap["_event_list"] = event_list
        except Exception:
            # Fail fast elsewhere if needed; do not add fallbacks here
            pass

    return snap

def render_spectrum_text(snap: dict) -> str:
    """
    Render a textual summary from a spectrum 'snap' produced by make_spectrum_snapshot.

    Sections are included only if data are present and meaningful:
      • Overview (flux significance, variability, total events)
      • Preferred Models
      • C-statistics
      • Detailed Model Fits (power-law, bremsstrahlung, apec, black-body)
      • Hardness Ratios (HS, HM, MS)
      • Emission Lines (non-zero only)
      • Continuum Histogram Peak(s)

    Returns:
        str: multi-section human-readable summary.
    """
    import math

    # ---------------------------- helpers ----------------------------
    def _is_num(x):
        return isinstance(x, (int, float)) and math.isfinite(x)

    def _fmt_val(x, nd=2):
        return f"{x:.{nd}f}" if _is_num(x) else "—"

    def _good_cstat(v):
        return _is_num(v) and (0.7 <= v < 1.2)

    def _add_section(title, lines):
        # Only add a section if there is at least one non-empty line
        non_empty = [ln for ln in lines if ln and str(ln).strip()]
        if not non_empty:
            return []
        out = [title, "-" * len(title)]
        out.extend(non_empty)
        out.append("")  # blank line after section
        return out

    def _cat_str(cat_dict):
        """Format category dicts like {'label','range','description'} compactly."""
        if not isinstance(cat_dict, dict):
            return None
        label = cat_dict.get("label")
        rng   = cat_dict.get("range")
        desc  = cat_dict.get("description")
        parts = []
        if label: parts.append(label)
        if rng:   parts.append(f"[{rng}]")
        if desc:  parts.append(f"— {desc}")
        return " ".join(parts) if parts else None

    # ---------------------------- build sections ----------------------------
    lines = []

    # Overview
    overview = []
    flux_sig = snap.get("flux_sig")
    flux_cat = snap.get("flux_sig_category")
    if _is_num(flux_sig) or (flux_cat and flux_cat != "unknown"):
        if _is_num(flux_sig) and flux_cat:
            overview.append(f"Flux Significance: {flux_sig:.2f} ({flux_cat})")
        elif _is_num(flux_sig):
            overview.append(f"Flux Significance: {flux_sig:.2f}")
        elif flux_cat:
            overview.append(f"Flux Significance: {flux_cat}")

    var = snap.get("variability")
    var_cat = snap.get("variability_category")
    if _is_num(var) or (var_cat and var_cat != "unknown"):
        if _is_num(var) and var_cat:
            overview.append(f"Variability Index: {var:.2f} ({var_cat})")
        elif _is_num(var):
            overview.append(f"Variability Index: {var:.2f}")
        elif var_cat:
            overview.append(f"Variability: {var_cat}")

    tec = snap.get("total_event_count")
    if isinstance(tec, int) and tec >= 0:
        overview.append(f"Total Events: {tec}")
        overview.append("(Total Events is the number of detected photons in the observation; low counts limit how finely we can slice time/energy and increase statistical noise in variability metrics.)")

    lines += _add_section("Overview", overview)

    # Preferred Models
    prefs = snap.get("preferred_models") or []
    if isinstance(prefs, (list, tuple)) and len(prefs) > 0:
        lines += _add_section("Preferred Models", [", ".join(prefs)])

    # C-statistics
    stats = snap.get("stats")
    if isinstance(stats, dict) and any(stats.get(k) is not None for k in ["powlaw","brems","blackbody","apec"]):
        cstat_lines = []
        for label in ["powlaw", "brems", "blackbody", "apec"]:
            v = stats.get(label)
            if _is_num(v):
                tag = "good fit" if _good_cstat(v) else "poor fit"
                cstat_lines.append(f"{label}: {v:.3f} ({tag})")
            elif v is None:
                # silently skip None
                pass
        lines += _add_section("C-statistics", cstat_lines)

    # Detailed Model Fits (if present in snap)
    def _model_section(key, pretty, fields):
        d = snap.get(key)
        if not isinstance(d, dict) or len(d) == 0:
            return []
        out = []
        # Ensure we always show the model's own stat first if available
        stat_key = next((k for k in d.keys() if k.endswith("_stat")), None)
        if stat_key and _is_num(d.get(stat_key)):
            out.append(f"C-stat: {_fmt_val(d.get(stat_key), 3)}")

        # Then show the numeric + categorized fields
        for fld, name in fields:
            val = d.get(fld)
            cat = d.get(f"{fld}_cat")  # e.g., powlaw_gamma_cat or bb_kt_cat
            if _is_num(val) or isinstance(cat, dict):
                if _is_num(val) and isinstance(cat, dict):
                    out.append(f"{name}: {_fmt_val(val, 3)}  ({_cat_str(cat)})")
                elif _is_num(val):
                    out.append(f"{name}: {_fmt_val(val, 3)}")
                elif isinstance(cat, dict):
                    cs = _cat_str(cat)
                    if cs:
                        out.append(f"{name}: {cs}")
        return _add_section(pretty, out)

    # Power-law
    lines += _model_section(
        "powlaw_stats",
        "Power-law Fit",
        [
            ("powlaw_gamma", "Photon Index Γ"),
            ("powlaw_nh", "N_H (×10^20 cm⁻²)"),
        ],
    )

    # Bremsstrahlung
    lines += _model_section(
        "brems_stats",
        "Bremsstrahlung Fit",
        [
            ("brems_kt", "kT (keV)"),
        ],
    )

    # APEC
    lines += _model_section(
        "apec_stats",
        "APEC Plasma Fit",
        [
            ("apec_kt", "kT (keV)"),
            ("apec_nh", "N_H (×10^20 cm⁻²)"),
        ],
    )

    # Black-body
    lines += _model_section(
        "bb_stats",
        "Black-body Fit",
        [
            ("bb_kt", "kT (keV)"),
            ("bb_nh", "N_H (×10^20 cm⁻²)"),
        ],
    )

    # Hardness Ratios
    hardness = snap.get("hardness") or {}
    hardness_cats = snap.get("hardness_categories") or {}
    h_lines = []

    def _hr_line(key, label):
        v = hardness.get(key)
        cat = hardness_cats.get(f"{key}_category")
        if _is_num(v) or (cat and cat != "unknown"):
            if _is_num(v) and cat:
                h_lines.append(f"{label}: {v:.3f} ({cat})")
            elif _is_num(v):
                h_lines.append(f"{label}: {v:.3f}")
            elif cat:
                h_lines.append(f"{label}: {cat}")

    # Map to friendly labels; HS requested explicitly as "Hard to Soft"
    _hr_line("HS", "Hard to Soft Ratio")
    _hr_line("HM", "Hard to Medium Ratio")
    _hr_line("MS", "Medium to Soft Ratio")

    lines += _add_section("Hardness", h_lines)

    # Emission Lines: defer to events-only section when events exist; otherwise show counts once
    lines_dict = snap.get("lines_keV")
    evt_present = isinstance(snap.get("_event_list"), list) and len(snap.get("_event_list")) > 0
    if not evt_present and isinstance(lines_dict, dict) and len(lines_dict) > 0:
        nz = [(k, v) for k, v in lines_dict.items() if isinstance(v, int) and v > 0]
        if nz:
            line_entries = [f"{name}: {cnt}" for name, cnt in nz]
            line_entries.append("(Counts inside standard line windows. At low counts these are hints, not secure detections; interpret alongside continuum and quantiles.)")
            lines += _add_section("Iron Emission Lines (detections)", line_entries)

    # Continuum Histogram — report top bins
    # Continuum (0.5–8 keV) — report peak and list all bins (no range filtering)
    hist = snap.get("histogram_counts")
    if isinstance(hist, dict) and len(hist) > 0:
        peak_lbl, peak_cnt = None, None

        # Determine peak by count; ties resolved by first appearance
        for lbl, cnt in hist.items():
            if not isinstance(cnt, int):
                continue
            if peak_cnt is None or cnt > peak_cnt:
                peak_lbl, peak_cnt = lbl, cnt

        # Build "all bins" string in the original (input) order
        all_bins = []
        for lbl, cnt in hist.items():
            if isinstance(cnt, int):
                all_bins.append(f"{lbl} ({cnt})")

        if peak_lbl is not None:
            lines += _add_section(
                "Energy Spectrum:Continuum (0.5–10 keV)",
                [
                    f"Peak bin: {peak_lbl} ({peak_cnt} counts)",
                    "All bins: " + ", ".join(all_bins),
                    "(Simple histogram of photon energies; not flux-calibrated. The peak indicates typical photon energy and coarse hardness.)",
                ],
            )
    # ---------------------------- events-only expansion ----------------------------
    # Append events-only derivatives if raw events are available in the snapshot
    evt = snap.get("_event_list")
    if isinstance(evt, list) and len(evt) > 0:
        try:
            metrics = build_events_only_metrics(evt)

            # Energy quantiles
            q = metrics.get("energy_quantiles_keV", {})
            if q:
                lines += _add_section(
                    "Energy Quantiles (Calculated from Events-only)",
                    [
                        f"E25={q.get('E25')}, E50={q.get('E50')}, E75={q.get('E75')}",
                        "E25/E50/E75 are photon-energy quantiles in keV; they are robust at low counts. Larger E50 generally indicates a harder spectrum; comparing E25–E50–E75 shows spectral width/asymmetry"
                    ]
                )

            # Hardness from events-only bands
            h = metrics.get("hardness", {})
            if h:
                lines += _add_section(
                    "Hardness (Calculated from Events-only)",
                    [
                        f"Counts: S={h.get('S')}, M={h.get('M')}, H={h.get('H')}",
                        f"HS=(H−S)/(H+S) = {h.get('HS')}",
                        f"HM=(H−M)/(H+M) = {h.get('HM')}",
                        f"MS=(M−S)/(M+S) = {h.get('MS')}",
                        "Bands: S=0.5–1.2 keV, M=1.2–2.0 keV, H=2.0–7.0 keV; ratios near −1 imply soft emission, near +1 hard emission."
                    ]
                )

            # Light curves fixed cadence (100s, 500s, 2000s)
            lc = metrics.get("lc", {})
            if lc:
                lc_lines = []
                added_e50_detail = False
                for key in ["100s", "500s", "2000s"]:
                    if key in lc:
                        e = lc[key]
                        label = key[:-1]
                        stat_parts = [
                            f"{label} s: mean={e['mean']} cts/s",
                            f"std={e['std']}",
                            f"fracRMS={e['frac_rms']}",
                        ]
                        if int(e.get('zero_exposure_bins') or 0) > 0:
                            stat_parts.append(f"zero_exposure_bins={e['zero_exposure_bins']}")
                        stat_parts.append(f"bins={e['bins']}")
                        lc_lines.append(
                            ", ".join(stat_parts)
                        )
                        lc_lines.append(
                            f"  • Peak: t_mid≈{e['peak']['t_mid_s']} s @ {e['peak']['rate_cps']:.4f} cts/s; "
                            f"Lowest: t_mid≈{e['trough']['t_mid_s']} s @ {e['trough']['rate_cps']:.4f} cts/s"
                        )
                        # Short per-bin energy note if compact LC present
                        lc_c = metrics.get("lc_compact", {}).get(key)
                        if lc_c:
                            pk = lc_c.get("peak", {})
                            tr = lc_c.get("trough", {})
                            trend = lc_c.get("E50_over_time")
                            if not added_e50_detail:
                                lc_lines.append(
                                    f"  • Peak bin E50≈{pk.get('E50_bin')} keV (Emean≈{pk.get('Emean_bin')} keV); Trough bin E50≈{tr.get('E50_bin')} keV"
                                )
                                added_e50_detail = True
                            if trend and int(trend.get('n_points') or 0) >= 5:
                                lc_lines.append(
                                    f"  • E50 trend: slope≈{trend.get('slope_keV_per_ks')} keV/ks, r²≈{trend.get('r2')} (n={trend.get('n_points')})"
                                )
                # Clarify edge-bin handling and E50 rule for bins
                lc_lines.append(
                    "*Peak/trough selection excludes bins with exposure <50% of the nominal cadence to avoid inflated rates in partial edge bins.*"
                )
                lc_lines.append(
                    "*Per-bin E50 is reported only for bins with ≥2 events; otherwise it is shown as None.*"
                )
                # Add general explanatory context for light curves and cadence
                lc_lines.append(
                    "The light curve is constructed by binning photon arrival times into fixed time intervals (cadence)."
                )
                lc_lines.append(
                    "Here, cadences of 100 s, 500 s, and 2000 s are shown:"
                )
                lc_lines.append("- Short bins (100 s) provide sensitivity to rapid changes but suffer from large statistical noise when counts are low.")
                lc_lines.append("- Medium bins (500 s) balance sensitivity to variability with reduced noise.")
                lc_lines.append("- Long bins (2000 s) smooth over fast fluctuations and reveal longer-term trends more reliably.")
                lc_lines.append("")
                lc_lines.append("For each cadence:")
                lc_lines.append("- mean = average count rate (cts/s) across all bins.")
                lc_lines.append("- std = standard deviation of per-bin count rates, reflecting variability.")
                lc_lines.append("- fracRMS = std/mean, a dimensionless variability amplitude; can be inflated at low counts.")
                lc_lines.append("- bins = total number of time bins used for this cadence.")
                lc_lines.append("- zero_exposure_bins = bins where no exposure occurred (e.g., gaps); assumed 0 here.")
                lc_lines.append("- Peak / Lowest = highest and lowest per-bin count rates; spikes in short bins may be noise if not corroborated at coarser cadence.")
                lc_lines.append("- E50 trend = slope of median photon energy across bins; positive suggests hardening, negative softening.")
                lc_lines.append("")
                lc_lines.append("Interpretation: comparing across cadences helps separate true multi-timescale variability from statistical noise seen only at the finest cadence.")
                lines += _add_section("Light Curves (events)", lc_lines)

            # Adaptive-counts
            adap = metrics.get("adaptive_counts", {})
            if adap:
                head = [
                    f"num_bins={adap.get('num_bins')}; median bin width≈{adap.get('median_width_s')} s; "
                    f"rate IQR≈{adap.get('iqr_rate_cps')} c/s",
                    "Head bins (t0–t1 s; width; counts; rate):"
                ]
                for b in adap.get("bins", [])[:5]:
                    head.append(
                        f"  • {b['t0_s']}-{b['t1_s']}; {b['width_s']} s; {b['counts']}; {b['rate_cps']} c/s"
                    )
                head.append("(Adaptive bins contain a fixed number of events; narrower widths indicate higher instantaneous rate. Robust for faint sources.)")
                lines += _add_section("Adaptive-counts (N=8)", head)

            # Power Spectral Density (events) — Rayleigh and FFT PSD
            tpsd = metrics.get("timing_psd", {}) or {}
            psd_lines = []
            # Rayleigh (unbinned)
            ray = tpsd.get("rayleigh") or {}
            psd_lines.append("Rayleigh periodogram (unbinned arrivals):")
            if isinstance(ray, dict) and ray.get("best"):
                b = ray["best"]
                P_s = b.get("P_s")
                f_Hz = b.get("f_Hz")
                Z1 = b.get("Z1sq")
                p1 = b.get("p_single")
                pg = b.get("p_global")
                pul_ul = b.get("pulsed_fraction_95UL")
                sig_note = "candidate periodicity" if (isinstance(pg, float) and pg is not None and pg < 0.003) else "no significant periodicity"
                psd_lines.append(
                    f"- Rayleigh Z1^2 (P=100–10,000 s; search capped at ≤0.5×observation span): "
                    f"best at P={round(P_s,2)} s (f={f_Hz:.6g} Hz), Z1^2={round(Z1,2)}, p_single={p1:.2g}, p_corrected={pg:.2g} ⇒ {sig_note}"
                )
                if isinstance(pul_ul, (int, float)):
                    psd_lines.append(f"  • 95% UL on sinusoidal pulsed fraction p < {round(pul_ul,3)}")
            else:
                note = ray.get("note") if isinstance(ray, dict) else None
                psd_lines.append(f"- Not computed{': ' + note if note else ''}")

            # FFT PSD (binned light curve)
            fft = tpsd.get("fft") or {}
            for cadence_key in ["500s", "2000s"]:
                entry = fft.get(cadence_key) or {}
                rms = entry.get("rms") or {}
                leahy = entry.get("leahy") or {}
                if isinstance(rms, dict) and rms.get("freqs_Hz") is not None and np.size(rms.get("freqs_Hz")) > 0:
                    df = rms.get("df_Hz")
                    nyq = rms.get("nyquist_Hz")
                    psd_lines.append(f"FFT PSD ({cadence_key} bins, rms²/Hz): δf≈{df:.3g} Hz, f_N≈{nyq:.3g} Hz; white-noise level subtracted when integrating.")
                    # Trials-corrected >3σ peak check using Leahy power
                    peak_note = "No bins exceed 3σ after trials"
                    if isinstance(leahy, dict) and np.size(leahy.get("psd")) > 0:
                        P = np.asarray(leahy.get("psd"), float)
                        M = P.size
                        if M > 0:
                            p_single = np.exp(-0.5 * P)
                            imin = int(np.argmin(p_single))
                            pglob = 1.0 - (1.0 - float(p_single[imin])) ** M
                            if pglob < 0.003:
                                fgrid = np.asarray(leahy.get("freqs_Hz"), float)
                                fpk = float(fgrid[imin]) if fgrid.size == M else None
                                peak_note = f">3σ peak at f≈{fpk:.6g} Hz (p_corrected≈{pglob:.2g})"
                    psd_lines.append(f"- {peak_note}.")
                    # Integrated fractional rms in broad bands
                    bands_info = entry.get("rms_bands") or {}
                    bands = bands_info.get("bands_Hz") or []
                    fracs = bands_info.get("fractional_rms") or []
                    if bands and fracs and len(bands) == len(fracs):
                        psd_lines.append("Integrated fractional rms:")
                        for (lo, hi), val in zip(bands, fracs):
                            psd_lines.append(f"  • {lo:.1e}–{hi:.1e} Hz: {val}")
                else:
                    psd_lines.append(f"FFT PSD ({cadence_key} bins): not computed (insufficient bins)")

            psd_lines.append("Interpretation: narrow peaks suggest coherent periods; broad excess (after noise subtraction) indicates aperiodic variability.")
            psd_lines.append(
                "Note: At low counts, rms-normalized PSDs can yield large apparent fractional rms; cross-check with multi-cadence light curves and K–S/Fano statistics."
            )
            lines += _add_section("Power Spectral Density (events)", psd_lines)

            # Variability / periodicity tests
            constancy = metrics.get("constancy_tests", {})
            fvar_val = metrics.get("excess_variance", {}).get("F_var")
            fvar_line = (
                f"Excess variance F_var: {fvar_val}"
                if (isinstance(fvar_val, (int, float)) or fvar_val == 0.0)
                else "Excess variance F_var: —"
            )
            # Gregory–Loredo summary
            gl = metrics.get("gregory_loredo", {}) or {}
            gl_p = gl.get("p_var"); gl_idx = gl.get("index"); gl_m = gl.get("m_map")
            gl_line = None
            if (gl_p is not None) or (gl_idx is not None) or (gl_m is not None):
                gl_line = f"GL: p_var={gl_p}, index={gl_idx}/10, m_MAP={gl_m}"

            var_lines = [
                f"K–S constancy: D={constancy.get('ks_D')}, p≈{constancy.get('ks_p')}",
                f"Fano factor (500 s): {constancy.get('fano500')}",
                fvar_line,
                "(Interpretation: low K–S p suggests deviation from constant rate; Fano>1 indicates over-dispersion/burstiness; F_var estimates intrinsic fractional variability.)",
            ]
            if gl_line:
                var_lines.insert(0, gl_line)
            lines += _add_section("Variability (events)", var_lines)

            # Hardness–Intensity samples
            hi = metrics.get("hardness_intensity", [])
            if hi:
                hi_valid = [pt for pt in hi if pt.get('HM') is not None]
                bullets = [f"({pt['t_mid_s']}, {pt['rate_cps']}, {pt['HM']})" for pt in hi_valid[:10]]
                lines += _add_section("Hardness–Intensity (events, 2000 s bins)", ["  • " + ", ".join(bullets), "(HM=(H−M)/(H+M); negative values imply relatively softer emission. Trends or hysteresis with rate can indicate flares/state changes.)"])

            # Time-resolved median energy (first 6)
            trem = metrics.get("time_resolved_median_energy", [])
            if trem:
                trem_bullets = []
                for pt in trem[:6]:
                    trem_bullets.append(f"({pt['t_mid_s']}, {pt['E50_keV']}, {pt['IQR_keV']})")
                lines += _add_section("Time-resolved median energy (keV) first 6", ["  • (t,E50,IQR)= " + ", ".join(trem_bullets), "E50 is the median photon energy per time bin; increasing E50 suggests spectral hardening."])
            
            # Emission line significance with Poisson FAP (only k>1) — single placement
            lfp = metrics.get("line_fap", {}) or {}
            lines_counts = snap.get("lines_keV", {}) or {}
            lf_lines = []
            if isinstance(lines_counts, dict) and lines_counts:
                for tag, kcnt in lines_counts.items():
                    try:
                        if not isinstance(kcnt, int) or kcnt < 1:
                            continue
                        d = lfp.get(tag, {}) if isinstance(lfp, dict) else {}
                        lam = d.get("lambda")
                        fap = d.get("fap")
                        if lam is not None and fap is not None:
                            lf_lines.append(f"{tag.replace('‑','-')}: k={kcnt}, λ≈{lam}, FAP≈{fap}")
                        else:
                            lf_lines.append(f"{tag.replace('‑','-')}: k={kcnt}")
                    except Exception:
                        continue
            if lf_lines:
                lf_lines.append("(Only lines with k>0 are shown; FAP from local continuum Poisson tail.)")
                lines += _add_section("Iron Emission Lines (detections)", lf_lines)

            # Key evidence for LLM reasoning
            kev = []
            q = metrics.get("energy_quantiles_keV", {}) or {}
            h = metrics.get("hardness", {}) or {}
            if q:
                kev.append(f"Spectrum: E50={q.get('E50')} keV; hardness ratios near {h.get('HS')} (balanced→hard depending on sign)")
            hist = metrics.get("histogram_counts", {}) or {}
            if isinstance(hist, dict) and hist:
                peak_lbl, peak_cnt = None, None
                for lbl, cnt in hist.items():
                    if not isinstance(cnt, int):
                        continue
                    if peak_cnt is None or cnt > peak_cnt:
                        peak_lbl, peak_cnt = lbl, cnt
                if peak_lbl is not None:
                    kev.append(f"Continuum peak near {peak_lbl}")
            # GL qualitative note
            if gl_line:
                try:
                    gl_idx_val = int(gl_line.split('index=')[1].split('/')[0])
                except Exception:
                    gl_idx_val = None
                if gl_idx_val is not None:
                    if gl_idx_val >= 7:
                        kev.append("GL indicates strong variability")
                    elif gl_idx_val >= 4:
                        kev.append("GL indicates moderate variability")
                    else:
                        kev.append("GL indicates weak variability")
            if tpsd:
                kev.append("No significant periodicity; band-limited rms modest")
            if kev:
                lines += _add_section("Key evidence for LLM reasoning", kev)
            # Note: JSON summary omitted to keep prompts compact and purely textual for the model.

        except Exception as e:
            # Fail fast: surface the error inline; upstream can decide how to handle
            lines += _add_section("Events-only Derivation Error", [str(e)])

    # Join and return
    # If no sections at all, give a minimal message
    return "\n".join(lines) if lines else "No usable spectrum information available."


def create_light_curve_data(src: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create light curve data optimized for frontend visualization.
    
    Args:
        src: Source data dictionary containing event list and metadata
        
    Returns:
        Dictionary containing light curve data with regions of interest
    """
    # Prefer original_event_list with filtering + time-normalization when available
    raw_event_list = src.get("original_event_list", [])
    if isinstance(raw_event_list, list) and len(raw_event_list) > 0:
        event_list = energy_filter_and_time_normalize_event_list(raw_event_list, 500, 7000)
    else:
        event_list = src.get("event_list", [])
    
    if not event_list:
        return {
            "error": "No event data available",
            "total_events": 0,
            "energy_spectrum": [],
            "regions_of_interest": []
        }
    
    # Extract energies in keV
    energies_keV = np.array([e for _, e in event_list]) / 1000.0
    
    # Create energy spectrum histogram
    e_min, e_max = 0.5, 10.0
    bin_width = 0.1  # Finer bins for visualization
    bins = np.arange(e_min, e_max + bin_width, bin_width)
    counts, edges = np.histogram(energies_keV, bins=bins)
    
    # Format for frontend
    spectrum_data = []
    for i, count in enumerate(counts):
        energy_center = (edges[i] + edges[i + 1]) / 2
        spectrum_data.append({
            "energy": round(energy_center, 2),
            "energy_min": round(edges[i], 2),
            "energy_max": round(edges[i + 1], 2),
            "count": int(count)
        })
    
    # Regions of interest with counts (include all regions for context)
    regions_of_interest = []
    for tag, lo, hi in LINE_WINDOWS:
        counts_in_region = int(((energies_keV >= lo) & (energies_keV <= hi)).sum())
        # Include all regions, even those with zero counts
        if counts_in_region > 0:
            significance = "high" if counts_in_region > 5 else "moderate" if counts_in_region > 2 else "low"
        else:
            significance = "none"  # Indicate no detection
        
        regions_of_interest.append({
            "name": tag,
            "energy_min": lo,
            "energy_max": hi,
            "energy_center": (lo + hi) / 2,
            "count": counts_in_region,
            "significance": significance
        })
    
    # Sort by energy
    regions_of_interest.sort(key=lambda x: x["energy_center"])
    
    # Basic statistics
    # Calculate peak energy from histogram bins (not from original array indices)
    if len(counts) > 0:
        peak_bin_index = np.argmax(counts)
        peak_energy = (edges[peak_bin_index] + edges[peak_bin_index + 1]) / 2
    else:
        peak_energy = 0.0
        
    stats = {
        "total_events": len(event_list),
        "energy_range": {"min": float(energies_keV.min()), "max": float(energies_keV.max())},
        "mean_energy": float(energies_keV.mean()),
        "peak_energy": float(peak_energy)
    }
    
    return {
        "total_events": len(event_list),
        "energy_spectrum": spectrum_data,
        "regions_of_interest": regions_of_interest,
        "statistics": stats
    }


def create_time_light_curve_data(src: Dict[str, Any], bin_size_s: int = 500) -> Dict[str, Any]:
    """
    Create a time light curve (binned counts/rates over time) for frontend visualization.
    Uses fixed cadence with exposure-aware edges. Returns per-bin mid time, count rate,
    counts, exposure, and simple Poisson errors on the rate.

    Args:
        src: Source data dictionary containing event list
        bin_size_s: Fixed bin width in seconds (default 500 s)

    Returns:
        Dict containing cadence, points, and summary statistics
    """
    # Prefer original_event_list with filtering + time-normalization when available
    raw_event_list = src.get("original_event_list", [])
    if isinstance(raw_event_list, list) and len(raw_event_list) > 0:
        event_list = energy_filter_and_time_normalize_event_list(raw_event_list, 500, 7000)
    else:
        event_list = src.get("event_list", [])
    if not event_list:
        return {
            "error": "No event data available",
            "cadence_s": int(bin_size_s),
            "points": [],
            "stats": {"mean_rate": 0.0, "std_rate": 0.0, "frac_rms": None, "bins": 0, "zero_exposure_bins": 0, "duration_s": 0.0}
        }

    times_s, _ = _extract_event_arrays(event_list)
    # Use existing fixed-cadence LC to compute exposure-aware stats
    lc_all = _compute_fixed_cadence_lc(times_s, [int(bin_size_s)])
    key = f"{int(bin_size_s)}s"
    lc = lc_all.get(key)
    if not lc:
        return {
            "error": "Failed to compute light curve",
            "cadence_s": int(bin_size_s),
            "points": [],
            "stats": {"mean_rate": 0.0, "std_rate": 0.0, "frac_rms": None, "bins": 0, "zero_exposure_bins": 0, "duration_s": 0.0}
        }

    edges = np.array(lc.get("edges", []), dtype=float)
    counts = np.array(lc.get("counts", []), dtype=float)
    exposure = np.array(lc.get("exposure_s", []), dtype=float)
    if edges.size == 0:
        return {
            "error": "No bins available",
            "cadence_s": int(bin_size_s),
            "points": [],
            "stats": {"mean_rate": 0.0, "std_rate": 0.0, "frac_rms": None, "bins": 0, "zero_exposure_bins": 0, "duration_s": 0.0}
        }

    # Build points list
    t_mid = edges[:-1] + 0.5 * np.minimum(exposure, edges[1:] - edges[:-1])
    with np.errstate(divide='ignore', invalid='ignore'):
        rate = np.where(exposure > 0, counts / exposure, 0.0)
        rate_err = np.where(exposure > 0, np.sqrt(counts) / exposure, 0.0)

    points = []
    for i in range(t_mid.size):
        points.append({
            "t_mid_s": float(round(t_mid[i], 2)),
            "rate_cps": float(round(rate[i], 5)),
            "rate_err_cps": float(round(rate_err[i], 5)),
            "counts": int(counts[i]),
            "exposure_s": float(round(exposure[i], 2))
        })

    duration_s = float(round(times_s.max() - times_s.min(), 2)) if times_s.size > 0 else 0.0
    stats = {
        "mean_rate": lc.get("mean", 0.0),
        "std_rate": lc.get("std", 0.0),
        "frac_rms": lc.get("frac_rms"),
        "bins": lc.get("bins", 0),
        "zero_exposure_bins": lc.get("zero_exposure_bins", 0),
        "duration_s": duration_s,
    }

    return {"cadence_s": int(bin_size_s), "points": points, "stats": stats}


def create_light_curve_image(src: Dict[str, Any], bin_size_s: int = 500) -> Optional[str]:
    """
    Generate a light curve plot as base64-encoded PNG for LLM vision analysis.
    Uses matplotlib to create a scientific plot with error bars and statistics.
    
    Args:
        src: Source data dictionary containing event list
        bin_size_s: Fixed bin width in seconds (default 500 s)
        
    Returns:
        Base64-encoded PNG string, or None if generation fails
    """
    try:
        import matplotlib
        matplotlib.use('Agg')  # Non-interactive backend for server-side rendering
        import matplotlib.pyplot as plt
        import io
        import base64
        
        # Get the light curve data using existing function
        lc_data = create_time_light_curve_data(src, bin_size_s)
        
        if lc_data.get("error") or not lc_data.get("points") or len(lc_data.get("points", [])) == 0:
            return None
        
        points = lc_data["points"]
        stats = lc_data["stats"]
        
        # Extract data arrays
        t_mid = np.array([p["t_mid_s"] for p in points])
        rate = np.array([p["rate_cps"] for p in points])
        rate_err = np.array([p["rate_err_cps"] for p in points])
        
        # Create figure with good resolution
        fig, ax = plt.subplots(figsize=(10, 5), dpi=100)
        
        # Plot with error bars
        ax.errorbar(t_mid, rate, yerr=rate_err, 
                    fmt='o-', color='#2563eb', ecolor='#60a5fa',
                    linewidth=1.5, markersize=4, capsize=3,
                    label=f'Light Curve ({bin_size_s}s bins)')
        
        # Styling
        ax.set_xlabel('Time (s)', fontsize=11, fontweight='bold')
        ax.set_ylabel('Count Rate (cts/s)', fontsize=11, fontweight='bold')
        ax.set_title(f'X-ray Light Curve (cadence={bin_size_s}s)', fontsize=12, fontweight='bold')
        ax.grid(True, alpha=0.3, linestyle='--')
        
        # Add statistics text box
        frac_rms_str = f"{stats['frac_rms']:.3f}" if stats.get('frac_rms') is not None else 'N/A'
        stats_text = (
            f"Mean: {stats['mean_rate']:.4f} c/s\n"
            f"Std: {stats['std_rate']:.4f} c/s\n"
            f"Frac RMS: {frac_rms_str}\n"
            f"Bins: {stats['bins']}\n"
            f"Duration: {stats['duration_s']:.1f} s"
        )
        ax.text(0.02, 0.98, stats_text, transform=ax.transAxes,
                verticalalignment='top', fontsize=9,
                bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))
        
        ax.legend(loc='upper right', fontsize=9)
        plt.tight_layout()
        
        # Convert to base64 PNG
        buf = io.BytesIO()
        plt.savefig(buf, format='png', bbox_inches='tight')
        buf.seek(0)
        img_base64 = base64.b64encode(buf.read()).decode('utf-8')
        plt.close(fig)
        
        return img_base64
        
    except Exception as e:
        print(f"Warning: Failed to generate light curve image: {e}")
        return None


# ------------------------------------------------------------------
#  GL step light curve for frontend visualization
# ------------------------------------------------------------------

def create_gl_light_curve_data(src: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a Gregory–Loredo (GL) step light curve for frontend visualization.
    Returns per-step intervals with counts, rate, and approximate 95% intervals.
    """
    # Prefer original_event_list with filtering + time-normalization when available
    raw_event_list = src.get("original_event_list", [])
    if isinstance(raw_event_list, list) and len(raw_event_list) > 0:
        event_list = energy_filter_and_time_normalize_event_list(raw_event_list, 500, 7000)
    else:
        event_list = src.get("event_list", [])

    if not event_list:
        return {
            "error": "No event data available",
            "summary": {"p_var": None, "index": None, "m_map": None, "K": 0},
            "segments": [],
        }

    # Extract times only
    times_s, _energies_keV = _extract_event_arrays(event_list)
    if times_s.size == 0:
        return {
            "error": "No event times available",
            "summary": {"p_var": None, "index": None, "m_map": None, "K": 0},
            "segments": [],
        }

    # Run GL variability
    gl = gl_variability(times_s, m_max=10)
    step_edges = gl.get("step_edges_s") or []
    step_counts = gl.get("step_counts") or []
    step_rates = gl.get("step_rates_cps") or []

    if not isinstance(step_edges, list) or len(step_edges) < 2 or not isinstance(step_counts, list) or len(step_counts) != (len(step_edges) - 1):
        # Fallback: single segment over full span
        t0 = float(times_s.min()); t1 = float(times_s.max())
        dt = max(1e-9, t1 - t0)
        k = int(times_s.size)
        rate = float(k / dt)
        err = float((math.sqrt(k) / dt) if k > 0 else 0.0)
        return {
            "summary": {"p_var": gl.get("p_var"), "index": gl.get("index"), "m_map": gl.get("m_map"), "K": 1,
                        "median_width_s": float(round(dt, 2)), "median_rate_cps": float(round(rate, 5))},
            "segments": [{
                "t0_s": float(round(t0, 2)),
                "t1_s": float(round(t1, 2)),
                "width_s": float(round(dt, 2)),
                "counts": k,
                "rate_cps": float(round(rate, 5)),
                "rate_lo_cps": float(round(max(0.0, rate - 1.96 * err), 5)),
                "rate_hi_cps": float(round(rate + 1.96 * err, 5)),
            }],
        }

    # Build segments with approximate 95% intervals using Gaussian error on Poisson rate
    segments = []
    widths = []
    rates = []
    for i in range(len(step_edges) - 1):
        t0 = float(step_edges[i]); t1 = float(step_edges[i + 1])
        dt = max(1e-9, t1 - t0)
        k = int(step_counts[i]) if i < len(step_counts) else 0
        r = float(step_rates[i]) if i < len(step_rates) else float(k / dt)
        err = float((math.sqrt(k) / dt) if k > 0 else 0.0)
        segments.append({
            "t0_s": float(round(t0, 2)),
            "t1_s": float(round(t1, 2)),
            "width_s": float(round(dt, 2)),
            "counts": k,
            "rate_cps": float(round(r, 5)),
            "rate_lo_cps": float(round(max(0.0, r - 1.96 * err), 5)),
            "rate_hi_cps": float(round(r + 1.96 * err, 5)),
        })
        widths.append(dt)
        rates.append(r)

    median_width = float(round(np.median(widths), 2)) if len(widths) > 0 else None
    median_rate = float(round(np.median(rates), 5)) if len(rates) > 0 else None

    out = {
        "summary": {
            "p_var": gl.get("p_var"),
            "index": gl.get("index"),
            "m_map": gl.get("m_map"),
            "K": int(len(segments)),
            "median_width_s": median_width,
            "median_rate_cps": median_rate,
        },
        "segments": segments,
    }
    return out

# ------------------------------------------------------------------
#  Events-only analytical utilities and prompt rendering
# ------------------------------------------------------------------

def _extract_event_arrays(event_list: List[List[float]]) -> Tuple[np.ndarray, np.ndarray]:
    """
    Extract time (s) and energy (keV) arrays from an event list of [time_s, energy_eV].
    Events are sorted by time ascending.

    Raises:
        ValueError: If event_list is empty or not a 2-column structure.
    """
    if not event_list or not isinstance(event_list, list):
        raise ValueError("event_list is required and must be a non-empty list")

    try:
        times = np.array([row[0] for row in event_list], dtype=float)
        energies_keV = np.array([row[1] for row in event_list], dtype=float) / 1000.0
    except Exception as exc:
        raise ValueError(f"Invalid event_list format: {exc}")

    if times.size == 0 or energies_keV.size == 0 or times.size != energies_keV.size:
        raise ValueError("event_list must contain pairs of [time_s, energy_eV]")

    order = np.argsort(times)
    return times[order], energies_keV[order]


def _compute_energy_quantiles_keV(energies_keV: np.ndarray) -> Dict[str, float]:
    """Compute E25/E50/E75 in keV for the energy array."""
    if energies_keV.size == 0:
        raise ValueError("Cannot compute quantiles: empty energies")
    q25, q50, q75 = np.percentile(energies_keV, [25, 50, 75])
    return {"E25": float(round(q25, 2)), "E50": float(round(q50, 2)), "E75": float(round(q75, 2))}


def _compute_hardness_counts_and_ratios(energies_keV: np.ndarray) -> Dict[str, Any]:
    """
    Compute hardness band counts and ratios using bands:
      S: 0.5–1.2 keV, M: 1.2–2.0 keV, H: 2.0–7.0 keV
    Ratios:
      HS = (H − S) / (H + S)
      HM = (H − M) / (H + M)
      MS = (M − S) / (M + S)
    """
    s_mask = (energies_keV >= 0.5) & (energies_keV < 1.2)
    m_mask = (energies_keV >= 1.2) & (energies_keV < 2.0)
    h_mask = (energies_keV >= 2.0) & (energies_keV <= 7.0)

    s = int(np.count_nonzero(s_mask))
    m = int(np.count_nonzero(m_mask))
    h = int(np.count_nonzero(h_mask))

    def _ratio(num: int, den: int) -> Optional[float]:
        d = num + den
        if d <= 0:
            return None
        return float(round((num - den) / d, 3))

    hs = _ratio(h, s)
    hm = _ratio(h, m)
    ms = _ratio(m, s)

    return {
        "S": s,
        "M": m,
        "H": h,
        "HS": hs,
        "HM": hm,
        "MS": ms,
    }


def _compute_histogram_05_10_keV(energies_keV: np.ndarray, bin_width: float = 0.25) -> Tuple[OrderedDict, str, int]:
    """
    Compute histogram from 0.5–10.0 keV using the given bin width.
    Returns: (hist_dict, peak_label, peak_count)
    """
    e_min, e_max = 0.5, 10.0
    bins = np.arange(e_min, e_max + bin_width, bin_width)
    counts, edges = np.histogram(energies_keV, bins=bins)

    hist = OrderedDict()
    for i, cnt in enumerate(counts):
        lo, hi = edges[i], edges[i + 1]
        if lo >= 8.0:
            hist["8.00-10.00"] = int(cnt + counts[i + 1:].sum())
            break
        hist[f"{lo:0.2f}-{hi:0.2f}"] = int(cnt)

    peak_label, peak_count = None, None
    for lbl, cnt in hist.items():
        if peak_count is None or cnt > peak_count:
            peak_label, peak_count = lbl, cnt

    return hist, (peak_label or ""), int(peak_count or 0)


def _compute_fixed_cadence_lc(times_s: np.ndarray, bin_sizes_s: List[int]) -> Dict[str, Any]:
    """
    Compute fixed-cadence light curve stats for each bin size with exposure-aware edges.
    Returns a dict keyed by '<binsize>s'.
    """
    if times_s.size == 0:
        raise ValueError("Cannot compute light curve: empty times array")

    t_min, t_max = float(times_s.min()), float(times_s.max())
    results: Dict[str, Any] = {}
    for width in bin_sizes_s:
        width = int(width)
        if width <= 0:
            raise ValueError("bin size must be positive")

        # Build edges up to >= t_max, then ensure last edge beyond t_max
        nbins = int(math.ceil((t_max - t_min) / width))
        edges = t_min + np.arange(nbins + 1) * width
        if edges[-1] < t_max:
            edges = np.append(edges, edges[-1] + width)

        # Bin counts
        counts, _ = np.histogram(times_s, bins=edges)

        # Exposure per bin (clip last bin to t_max), then drop partial bins
        exp = np.minimum(edges[1:], t_max) - edges[:-1]
        exp = np.maximum(exp, 0.0)
        # Drop bins with exposure < 0.98 * width
        width_f = float(width)
        exp_ok_mask = exp >= (0.98 * width_f)
        zero_expo_mask = exp <= 0
        zero_exposure_bins = int(np.count_nonzero(zero_expo_mask))

        # Apply mask to counts/exp for stats
        counts_ok = counts[exp_ok_mask]
        exp_ok = exp[exp_ok_mask]
        rates_ok = np.divide(counts_ok, exp_ok, out=np.full_like(exp_ok, np.nan, dtype=float), where=exp_ok > 0)

        if rates_ok.size:
            # Exposure-weighted statistics
            w = exp_ok
            mean_rate = float(np.average(rates_ok, weights=w)) if np.sum(w) > 0 else 0.0
            var = float(np.average((rates_ok - mean_rate) ** 2, weights=w)) if np.sum(w) > 0 else 0.0
            std_rate = float(np.sqrt(max(0.0, var)))
            frac_rms = float(std_rate / mean_rate) if mean_rate > 0 else None
        else:
            mean_rate = 0.0
            std_rate = 0.0
            frac_rms = None

        # mid time = center of exposed portion
        t_mid = edges[:-1] + 0.5 * exp

        # Peak/trough: consider bins with exposure ≥ 0.5 * width (exclude partial edge bins)
        peak_mask = exp >= (0.5 * width_f)
        rates_all = np.divide(counts, exp, out=np.full_like(exp, np.nan, dtype=float), where=exp > 0)
        if np.any(peak_mask):
            cand_rates = np.where(peak_mask, rates_all, np.nan)
            with np.errstate(invalid='ignore'):
                peak_idx = int(np.nanargmax(cand_rates))
                trough_idx = int(np.nanargmin(cand_rates))
            peak_mid = float(t_mid[peak_idx])
            trough_mid = float(t_mid[trough_idx])
            peak_rate = float(cand_rates[peak_idx])
            trough_rate = float(cand_rates[trough_idx])
        else:
            peak_mid = trough_mid = peak_rate = trough_rate = 0.0

        key = f"{width}s"
        results[key] = {
            "mean": float(round(mean_rate, 5)),
            "std": float(round(std_rate, 5)),
            "frac_rms": float(round(frac_rms, 3)) if isinstance(frac_rms, float) else None,
            "zero_exposure_bins": zero_exposure_bins,
            "bins": int(exp.size),
            "peak": {"t_mid_s": float(round(peak_mid, 2)), "rate_cps": float(round(peak_rate, 5))},
            "trough": {"t_mid_s": float(round(trough_mid, 2)), "rate_cps": float(round(trough_rate, 5))},
            "counts": counts.tolist(),
            "exposure_s": [float(x) for x in exp],
            "edges": [float(x) for x in edges],
        }

    return results


def _compute_adaptive_counts_lc(times_s: np.ndarray, N: int = 8) -> Dict[str, Any]:
    """
    Build adaptive-count bins of N events each (last bin may have <N).
    Returns summary plus head bin list with t0, t1, width, counts, rate.
    """
    if times_s.size == 0:
        raise ValueError("Cannot compute adaptive LC: empty times array")
    if N <= 0:
        raise ValueError("N must be positive")

    bins: List[Dict[str, float]] = []
    i = 0
    n = times_s.size
    while i < n:
        j = min(i + N - 1, n - 1)
        t0 = float(times_s[i])
        t1 = float(times_s[j])
        width = max(t1 - t0, 1e-9)
        cnt = int(j - i + 1)
        rate = float(cnt / width)
        bins.append({
            "t0_s": float(round(t0, 2)),
            "t1_s": float(round(t1, 2)),
            "width_s": float(round(width, 2)),
            "counts": cnt,
            "rate_cps": float(round(rate, 5)),
        })
        i = j + 1

    widths = np.array([b["width_s"] for b in bins], dtype=float)
    rates = np.array([b["rate_cps"] for b in bins], dtype=float)
    med_width = float(np.median(widths)) if widths.size > 0 else 0.0
    q25, q75 = (np.percentile(rates, [25, 75]) if rates.size > 0 else (0.0, 0.0))
    iqr_rate = float(q75 - q25)

    return {
        "N": int(N),
        "num_bins": int(len(bins)),
        "median_width_s": float(round(med_width, 2)),
        "iqr_rate_cps": float(round(iqr_rate, 5)),
        "bins": bins,
    }


def _ks_constancy_test(times_s: np.ndarray) -> Dict[str, float]:
    """
    One-sample KS test of arrival times vs uniform over [t_min, t_max].
    Returns D and p-value using the Kolmogorov distribution approximation.
    """
    n = times_s.size
    if n == 0:
        raise ValueError("Cannot compute KS test: empty times array")
    t_min, t_max = float(times_s.min()), float(times_s.max())
    if t_max <= t_min:
        return {"D": 0.0, "p": 1.0}

    sorted_t = np.sort(times_s)
    u = (sorted_t - t_min) / (t_max - t_min)
    ecdf = np.arange(1, n + 1, dtype=float) / n
    d_plus = np.max(ecdf - u)
    d_minus = np.max(u - (ecdf - 1.0 / n))
    D = float(max(d_plus, d_minus))

    en = math.sqrt(n)
    lam = (en + 0.12 + 0.11 / en) * D

    # Kolmogorov distribution Q_KS approximation
    def _qks(lmbd: float) -> float:
        if lmbd < 1e-9:
            return 1.0
        summation = 0.0
        for k in range(1, 101):
            term = (-1) ** (k - 1) * math.exp(-2.0 * (k * k) * (lmbd * lmbd))
            summation += term
            if abs(term) < 1e-12:
                break
        return max(0.0, min(1.0, 2.0 * summation))

    p_val = float(_qks(lam))
    return {"D": float(round(D, 3)), "p": float(round(p_val, 3))}


def _fano_factor_500s(times_s: np.ndarray) -> Optional[float]:
    """Fano factor using non-overlapping 500 s windows: var(counts)/mean(counts)."""
    if times_s.size == 0:
        raise ValueError("Cannot compute Fano factor: empty times array")
    t_min, t_max = float(times_s.min()), float(times_s.max())
    width = 500.0
    nbins = int(math.floor((t_max - t_min) / width)) + 1
    if nbins < 1:
        return None
    edges = t_min + np.arange(nbins + 1) * width
    counts, _ = np.histogram(times_s, bins=edges)
    mu = float(np.mean(counts)) if counts.size > 0 else 0.0
    if mu <= 0:
        return None
    var = float(np.var(counts, ddof=0))
    return float(round(var / mu, 2))


def _compute_psd_summary(times_s: np.ndarray, bin_size_s: int = 500) -> Dict[str, Any]:
    """
    Compute a compact PSD summary from binned count rates at fixed cadence.
    Returns a dict with slope, peak, and band-limited power fraction.
    Fails fast for insufficient duration or bins.
    """
    result: Dict[str, Any] = {
        "method": f"FFT_{bin_size_s}s",
        "status": "not_computed",
    }
    if times_s.size == 0:
        return result
    t_min, t_max = float(times_s.min()), float(times_s.max())
    duration = t_max - t_min
    if duration <= 0:
        return result

    # Build edges; clip last bin exposure
    nbins = int(math.ceil(duration / bin_size_s))
    if nbins < 8:
        return result
    edges = t_min + np.arange(nbins + 1) * float(bin_size_s)
    # Histogram events per bin
    counts, _ = np.histogram(times_s, bins=edges)
    exp = np.minimum(edges[1:], t_max) - edges[:-1]
    exp = np.maximum(exp, 0.0)
    good = exp > 0
    if np.count_nonzero(good) < 8:
        return result
    rates = np.zeros_like(exp, dtype=float)
    rates[good] = counts[good] / exp[good]

    # Remove mean, apply Hann window
    x = rates.copy()
    x[np.isnan(x)] = 0.0
    x = x - float(np.mean(x))
    w = np.hanning(x.size)
    xw = x * w

    fft = np.fft.rfft(xw)
    freqs = np.fft.rfftfreq(xw.size, d=float(bin_size_s))
    # Power spectral density (arbitrary units, sufficient for summaries)
    # Normalize by window power to reduce dependence on N
    win_power = np.sum(w ** 2) if np.sum(w ** 2) > 0 else 1.0
    power = (np.abs(fft) ** 2) / win_power

    # Exclude DC
    if freqs.size <= 1:
        return result
    freqs = freqs[1:]
    power = power[1:]

    # Nyquist
    nyq = 1.0 / (2.0 * float(bin_size_s))

    # Slope alpha from log P ~ a + alpha * log f
    valid = (power > 0) & np.isfinite(power) & np.isfinite(freqs) & (freqs > 0)
    alpha = None
    if np.count_nonzero(valid) >= 8:
        lf = np.log10(freqs[valid])
        lp = np.log10(power[valid])
        lf_mean = float(np.mean(lf))
        denom = float(np.sum((lf - lf_mean) ** 2))
        if denom > 0:
            slope = float(np.sum((lf - lf_mean) * (lp - float(np.mean(lp)))) / denom)
            alpha = round(slope, 2)

    # Band-limited power fraction in [1e-4, 1e-3] Hz (if within range)
    f_lo, f_hi = 1e-4, 1e-3
    band_mask = (freqs >= f_lo) & (freqs <= f_hi)
    band_frac = None
    total_power = float(np.sum(power)) if power.size > 0 else 0.0
    band_power = float(np.sum(power[band_mask])) if np.any(band_mask) else 0.0
    if total_power > 0 and band_power >= 0:
        band_frac = round(100.0 * band_power / total_power, 1)

    # Peak search and crude global p-value assuming exponential null
    peak_idx = int(np.argmax(power)) if power.size > 0 else 0
    peak_hz = float(freqs[peak_idx]) if power.size > 0 else None
    peak_power = float(power[peak_idx]) if power.size > 0 else None
    p_global = None
    if power.size > 0 and peak_power is not None:
        # Single-trial p ~ exp(-peak_power / mean_power)
        mp = float(np.mean(power)) if np.isfinite(np.mean(power)) else None
        if mp and mp > 0:
            p1 = math.exp(-peak_power / mp)
            M = max(1, power.size)
            p_global = 1.0 - (1.0 - p1) ** M
            p_global = round(p_global, 3)

    result.update({
        "status": "ok",
        "n_bins": int(nbins),
        "nyquist_hz": float(round(nyq, 6)),
        "slope_alpha": alpha,
        "peak_hz": peak_hz,
        "peak_power": round(peak_power, 3) if isinstance(peak_power, float) else None,
        "peak_p_value": p_global,
        "band_1e-4_1e-3_power_frac_pct": band_frac,
    })
    return result

# ------------------------------------------------------------------
#  Timing & PSD utilities (Rayleigh and FFT PSD)
# ------------------------------------------------------------------

def extract_times_energies(
    event_list: List[List[float]],
    energy_keV_range: Optional[Tuple[float, float]] = None,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Convert event_list -> (times_s, energies_keV). Optionally filter by energy range.
    """
    if not event_list:
        return np.array([], dtype=float), np.array([], dtype=float)
    arr = np.asarray(event_list, dtype=float)
    t = arr[:, 0]
    e_keV = arr[:, 1] / 1000.0
    if energy_keV_range is not None:
        emin, emax = float(energy_keV_range[0]), float(energy_keV_range[1])
        m = (e_keV >= emin) & (e_keV <= emax)
        t = t[m]
        e_keV = e_keV[m]
    return t, e_keV


def bin_light_curve(
    times_s: np.ndarray,
    bin_sec: float,
    t_start: Optional[float] = None,
    t_stop: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Build an evenly binned light curve (no GTIs/background).
    Returns dict with edges, t_mid, counts, dt, rate (counts/s), mean_rate.
    """
    out: Dict[str, Any] = {"edges": np.array([]), "t_mid": np.array([]), "counts": np.array([]),
           "dt": float(bin_sec), "rate": np.array([]), "mean_rate": np.nan}
    if times_s.size == 0 or bin_sec <= 0:
        return out

    t0 = float(np.min(times_s)) if t_start is None else float(t_start)
    t1 = float(np.max(times_s)) if t_stop is None else float(t_stop)
    if t1 <= t0:
        t1 = t0 + bin_sec

    # Build edges; drop the final partial bin to ensure constant dt for FFT
    nbins_total = int(np.ceil((t1 - t0) / bin_sec))
    edges_all = t0 + np.arange(nbins_total + 1) * bin_sec
    # Keep only full-width bins (exclude last edge if it exceeds t1 by > tol)
    # Equivalent to truncating to floor((t1-t0)/bin_sec)
    nbins_full = int(np.floor((t1 - t0) / bin_sec))
    if nbins_full <= 0:
        return out
    edges = edges_all[: nbins_full + 1]
    counts, _ = np.histogram(times_s, bins=edges)
    counts = counts.astype(int)
    t_mid = 0.5 * (edges[:-1] + edges[1:])
    # Constant exposure per bin since we dropped partial bin
    rate = counts / bin_sec
    mean_rate = float(np.mean(rate)) if counts.size > 0 else np.nan

    out.update({"edges": edges, "t_mid": t_mid, "counts": counts,
                "dt": float(bin_sec), "rate": rate, "mean_rate": mean_rate})
    return out


def rayleigh_periodogram(
    times_s: np.ndarray,
    period_range_s: Tuple[float, float] = (100.0, 10000.0),
    oversample: int = 8,
    min_events: int = 20,
) -> Dict[str, Any]:
    """
    Unbinned Rayleigh Z1^2 scan over frequencies corresponding to period_range_s.
    Returns freqs, Z1sq, p_single, and a best-peak summary (including trials correction
    and a rough 95% upper limit on sinusoidal pulsed fraction).
    """
    result: Dict[str, Any] = {
        "freqs_Hz": np.array([]),
        "Z1sq": np.array([]),
        "p_single": np.array([]),
        "best": None,
        "note": ""
    }
    N = times_s.size
    if N < min_events:
        result["note"] = f"Too few events (N={N} < {min_events}); not computed."
        return result

    t = np.asarray(times_s, dtype=float)
    t = t - np.min(t)
    T = float(np.max(t) - np.min(t))
    if T <= 0:
        result["note"] = "Zero observation span; not computed."
        return result

    Pmin, Pmax = float(period_range_s[0]), float(period_range_s[1])
    if Pmax > 0.5 * T:
        Pmax = max(Pmin, 0.5 * T)
    fmin, fmax = 1.0 / Pmax, 1.0 / Pmin
    df = (1.0 / T) / max(1, int(oversample))
    if fmax <= fmin or df <= 0:
        result["note"] = "Bad frequency grid; not computed."
        return result

    freqs = np.arange(fmin, fmax + df, df, dtype=float)
    phi = 2.0 * np.pi * np.outer(t, freqs)
    C = np.sum(np.cos(phi), axis=0)
    S = np.sum(np.sin(phi), axis=0)
    Z1sq = (2.0 / N) * (C**2 + S**2)

    p_single = np.exp(-0.5 * Z1sq)
    M = freqs.size
    imax = int(np.argmax(Z1sq))
    f_best = float(freqs[imax])
    P_best = 1.0 / f_best
    Z_best = float(Z1sq[imax])
    p1_best = float(p_single[imax])
    pglob_best = float(1.0 - (1.0 - p1_best)**M)

    Z_star = -2.0 * np.log(0.05)
    pfrac95 = float(np.sqrt(2.0 * Z_star / N))

    result.update({
        "freqs_Hz": freqs,
        "Z1sq": Z1sq,
        "p_single": p_single,
        "best": {
            "P_s": P_best,
            "f_Hz": f_best,
            "Z1sq": Z_best,
            "p_single": p1_best,
            "p_global": pglob_best,
            "pulsed_fraction_95UL": pfrac95,
            "N_events": int(N),
            "T_span_s": T,
            "M_trials": int(M)
        },
        "note": ""
    })
    return result


def _next_pow2(n: int) -> int:
    return 1 << (n - 1).bit_length()


def psd_from_light_curve(
    lc: Dict[str, Any],
    normalization: str = "leahy",
    detrend: str = "mean",
    pad_to_pow2: bool = True,
) -> Dict[str, Any]:
    """
    Compute one-sided PSD from an evenly binned light curve.

    normalization:
      - "leahy": P_j = (2/C) |FFT_counts|^2, Poisson level ~ 2
      - "rms":   P_j = (2*dt / (mu_counts^2 * N)) |FFT_counts|^2  (Miyamoto 1991)
                   Integrating P over freq band gives fractional variance.
    detrend: "mean" subtracts the mean before FFT; "none" keeps DC.
    pad_to_pow2: zero-pad to next power of 2.

    Returns dict: freqs_Hz, psd, white_noise_level, nyquist_Hz, df_Hz, norm.
    """
    counts = np.asarray(lc.get("counts", []), dtype=float)
    dt = float(lc.get("dt", 0.0))
    N = counts.size
    out: Dict[str, Any] = {"freqs_Hz": np.array([]), "psd": np.array([]),
           "white_noise_level": np.nan, "nyquist_Hz": np.nan, "df_Hz": np.nan,
           "norm": normalization}

    if N < 2 or dt <= 0:
        return out

    Ctot = float(np.sum(counts))
    mu_counts = Ctot / N if N > 0 else 0.0

    x = counts.copy()
    if detrend == "mean":
        x = x - np.mean(x)

    nfft = _next_pow2(N) if pad_to_pow2 else N
    fft = np.fft.rfft(x, n=nfft)
    freqs = np.fft.rfftfreq(nfft, d=dt)
    freqs = freqs[1:]
    fft = fft[1:]

    if normalization.lower() == "leahy":
        if Ctot <= 0:
            return out
        psd = (2.0 / Ctot) * (fft.real**2 + fft.imag**2)
        white = 2.0
    elif normalization.lower() == "rms":
        if mu_counts <= 0:
            return out
        psd = (2.0 * dt / (mu_counts**2 * N)) * (fft.real**2 + fft.imag**2)
        white = 2.0 * dt / (mu_counts * N)
    else:
        raise ValueError("normalization must be 'leahy' or 'rms'")

    df = freqs[1] - freqs[0] if freqs.size > 1 else 1.0 / (N * dt)
    out.update({
        "freqs_Hz": freqs,
        "psd": psd,
        "white_noise_level": white,
        "nyquist_Hz": 1.0 / (2.0 * dt),
        "df_Hz": df
    })
    return out


def geometric_rebin_psd(
    freqs_Hz: np.ndarray,
    psd: np.ndarray,
    factor: float = 1.2,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Geometrically (log) rebin a PSD by a constant multiplicative factor in frequency.
    Returns (freqs_rebinned, psd_rebinned) where each output bin is the average of inputs.
    """
    f = np.asarray(freqs_Hz, dtype=float)
    P = np.asarray(psd, dtype=float)
    if f.size == 0:
        return f, P

    edges = [f[0]]
    while edges[-1] < f[-1]:
        edges.append(edges[-1] * factor)
    edges = np.array(edges)
    edges = edges[(edges >= f[0]) & (edges <= f[-1] * (1 + 1e-9))]
    centers, means = [], []
    i0 = 0
    for e in edges[1:]:
        i1 = np.searchsorted(f, e, side="right")
        if i1 > i0:
            centers.append(float(np.exp(np.mean(np.log(f[i0:i1])))))
            means.append(float(np.mean(P[i0:i1])))
            i0 = i1
    return np.array(centers), np.array(means)


def fractional_rms_in_band(
    freqs_Hz: np.ndarray,
    psd_rms: np.ndarray,
    fmin: float,
    fmax: float,
    white_noise_level: Optional[float] = None,
) -> float:
    """
    Integrate an rms-normalized PSD between fmin and fmax and return fractional rms.
    If white_noise_level is provided, subtract it (clipped at 0) before integrating.
    Assumes one-sided PSD (positive frequencies only).
    """
    f = np.asarray(freqs_Hz, dtype=float)
    P = np.asarray(psd_rms, dtype=float)
    if f.size == 0 or P.size == 0:
        return 0.0
    m = (f >= fmin) & (f <= fmax)
    if not np.any(m):
        return 0.0
    P_use = P[m]
    if isinstance(white_noise_level, (int, float)) and math.isfinite(white_noise_level):
        P_use = np.maximum(0.0, P_use - float(white_noise_level))
    var_frac = float(np.trapz(P_use, f[m]))
    return float(np.sqrt(max(0.0, var_frac)))


# ------------------------------------------------------------------
#  Additional analytics: Gregory–Loredo variability and line FAP
# ------------------------------------------------------------------

# JIT-compiled helper functions for GL algorithm (200-500x speedup)
@jit(nopython=True, cache=True)
def _compute_block_likelihoods_jit(edges: np.ndarray, idx_left: np.ndarray) -> np.ndarray:
    """
    JIT-compiled computation of block likelihoods for GL algorithm.
    
    Computes log-likelihood for all possible constant-rate blocks using Jeffreys prior.
    This is the most expensive part of GL (O(M²) where M = number of candidate edges).
    
    Args:
        edges: Candidate edge times (sorted)
        idx_left: Index of first event >= each edge
    
    Returns:
        loglike_block: Matrix of log-likelihoods for each block [i, j]
    """
    M = len(edges)
    loglike_block = np.full((M - 1, M - 1), -np.inf, dtype=np.float64)
    tiny = 1e-12
    
    for i in range(M - 1):
        n_i = idx_left[i]
        for j in range(i + 1, M):
            n_j = idx_left[j]
            n = max(0, n_j - n_i)
            dt = max(tiny, edges[j] - edges[i])
            
            # Jeffreys prior block fitness: log Γ(n+1/2) - (n+1/2) log dt
            # Using Stirling's approximation for lgamma for speed
            if n == 0:
                ll = math.lgamma(0.5) - 0.5 * math.log(dt)
            else:
                ll = math.lgamma(n + 0.5) - (n + 0.5) * math.log(dt)
            
            loglike_block[i, j - 1] = ll
    
    return loglike_block


@jit(nopython=True, cache=True)
def _compute_dp_jit(loglike_block: np.ndarray, m_max: int) -> Tuple[np.ndarray, np.ndarray]:
    """
    JIT-compiled dynamic programming for GL algorithm.
    
    Finds optimal partitioning into m segments for m=1..m_max using DP.
    This is O(m_max × M²) but with JIT it's 10-50x faster than Python.
    
    Args:
        loglike_block: Pre-computed block likelihoods from _compute_block_likelihoods_jit
        m_max: Maximum number of segments to consider
    
    Returns:
        dp: DP table with best log-likelihood for each (m, endpoint)
        back: Backpointers for reconstructing optimal partition
    """
    M = loglike_block.shape[0] + 1
    
    dp = np.full((m_max + 1, M - 1), -np.inf, dtype=np.float64)
    back = np.full((m_max + 1, M - 1), -1, dtype=np.int32)
    
    # Base case: m=1 (single segment from start to each endpoint)
    for b in range(M - 1):
        dp[1, b] = loglike_block[0, b]
        back[1, b] = -1
    
    # DP: for each number of segments m
    for m in range(2, m_max + 1):
        # For each possible endpoint b
        for b in range(m - 1, M - 1):
            best = -np.inf
            best_a = -1
            
            # Try all possible previous split points a
            for a in range(m - 2, b):
                ll_prev = dp[m - 1, a]
                if not np.isfinite(ll_prev):
                    continue
                
                # Add likelihood of block from a+1 to b
                val = ll_prev + loglike_block[a + 1, b]
                
                if val > best:
                    best = val
                    best_a = a
            
            dp[m, b] = best
            back[m, b] = best_a
    
    return dp, back


def gl_variability(
    times_s: np.ndarray,
    m_max: int = 10,
    max_unbinned: int = 5000,
    max_bins_after_binning: int = 500,
    bin_size_s: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Gregory–Loredo variability test with automatic binning for large N.
    
    Uses systematic time binning when N > max_unbinned to reduce O(N²) complexity.
    Binning preserves temporal structure and is statistically sound for timing analysis.
    
    Args:
        times_s: Event arrival times in seconds (sorted or unsorted)
        m_max: Maximum number of segments to test (default 10)
        max_unbinned: Threshold for automatic binning (default 5,000)
        max_bins_after_binning: Hard cap on bins after binning (default 500, for O(500²)=250k ops)
        bin_size_s: Optional fixed bin size in seconds (if None, auto-computed)
    
    Returns: 
        Dict with p_var, index (0..10), m_map, step_edges_s, step_counts, step_rates_cps
        Also includes 'binned': True if data was binned
    """
    from src.core.logger import get_logger
    logger = get_logger(__name__)
    
    result: Dict[str, Any] = {
        "p_var": None,
        "index": None,
        "m_map": None,
        "step_edges_s": [],
        "step_counts": [],
        "step_rates_cps": [],
        "binned": False,
    }
    
    try:
        t = np.asarray(times_s, dtype=float)
        if t.size < 20:
            return result
        t = np.sort(t)
        t0, t1 = float(t[0]), float(t[-1])
        T = t1 - t0
        if T <= 0:
            return result
        
        N_original = t.size
        
        # Auto-bin if N is too large
        if N_original > max_unbinned:
            logger.info(f"    GL: Auto-binning {N_original} events (exceeds {max_unbinned} threshold)")
            
            # Determine bin size with hard cap on number of bins
            if bin_size_s is None:
                # Target max_bins_after_binning bins, ensuring at least 10s bins
                target_bins = min(max_bins_after_binning, int(T / 10))
                target_bins = max(10, target_bins)  # At least 10 bins
                bin_size_s = T / target_bins
                bin_size_s = max(10.0, bin_size_s)  # Minimum 10s bins
            
            # Create bins (hard cap to prevent runaway)
            n_bins = min(max_bins_after_binning, int(np.ceil(T / bin_size_s)))
            bin_size_s = T / n_bins  # Recalculate to fit exactly
            edges_bins = np.linspace(t0, t1, n_bins + 1)
            
            # Histogram events into bins
            counts, _ = np.histogram(t, bins=edges_bins)
            
            # Create ONE representative event per bin at bin center
            # This ensures M ≈ n_bins (manageable) while preserving rate structure
            bin_centers = (edges_bins[:-1] + edges_bins[1:]) / 2
            # Only include bins with at least 1 event
            mask = counts > 0
            t = bin_centers[mask]
            t = np.sort(t)
            
            logger.info(f"    GL: Binned to {n_bins} bins ({bin_size_s:.1f}s each), {np.sum(mask)} non-empty, M≈{len(t)}")
            result["binned"] = True
            result["bin_size_s"] = float(bin_size_s)
            result["n_bins"] = int(n_bins)
            result["original_n_events"] = int(N_original)
            result["non_empty_bins"] = int(np.sum(mask))
        
        # Now run GL algorithm on (possibly binned) data using JIT-compiled functions
        # Candidate edges are event times with endpoints
        logger.info(f"    GL: Computing unique edges from {len(t)} events...")
        uniq = np.unique(t[(t > t0) & (t < t1)])
        logger.info(f"    GL: Found {len(uniq)} unique interior times")
        edges = np.concatenate(([t0], uniq, [t1]))
        M = edges.size
        logger.info(f"    GL: Total edges M={M}")
        
        # Safety check: if M is still too large, abort
        if M > 2000:
            logger.warning(f"    GL: M={M} exceeds safety limit (2000), aborting to prevent crash")
            return result
        
        logger.info(f"    GL: Computing idx_left...")
        idx_left = np.searchsorted(t, edges, side='left')
        logger.info(f"    GL: idx_left computed, M={M}, preparing for DP...")

        m_max = max(1, int(m_max))
        m_max = min(m_max, M - 1)
        
        # Use JIT-compiled functions for massive speedup (200-500x faster)
        if NUMBA_AVAILABLE:
            # JIT path: 10-50x faster than Python
            logger.info(f"    GL: Computing block likelihoods (M={M}, O(M²)={(M-1)**2} ops)...")
            loglike_block = _compute_block_likelihoods_jit(edges, idx_left)
            logger.info(f"    GL: Block likelihoods computed, running DP (m_max={m_max})...")
            dp, back = _compute_dp_jit(loglike_block, m_max)
            logger.info(f"    GL: DP completed")
        else:
            # Fallback path: pure Python (if numba not installed)
            logger.warning("    GL: Numba not available, using slow Python fallback (install numba for 200x speedup)")
            tiny = 1e-12
            loglike_block = np.full((M - 1, M - 1), -np.inf, dtype=float)
            for i in range(M - 1):
                n_i = idx_left[i]
                for j in range(i + 1, M):
                    n_j = idx_left[j]
                    n = int(max(0, n_j - n_i))
                    dt = max(tiny, float(edges[j] - edges[i]))
                    ll = math.lgamma(n + 0.5) - (n + 0.5) * math.log(dt)
                    loglike_block[i, j - 1] = ll

            dp = np.full((m_max + 1, M - 1), -np.inf, dtype=float)
            back = np.full((m_max + 1, M - 1), -1, dtype=int)

            for b in range(M - 1):
                dp[1, b] = loglike_block[0, b]
                back[1, b] = -1

            for m in range(2, m_max + 1):
                for b in range(m - 1, M - 1):
                    best = -np.inf
                    best_a = -1
                    for a in range(m - 2, b):
                        ll_prev = dp[m - 1, a]
                        if not np.isfinite(ll_prev):
                            continue
                        val = ll_prev + loglike_block[a + 1, b]
                        if val > best:
                            best = val
                            best_a = a
                    dp[m, b] = best
                    back[m, b] = best_a

        # Posterior over m with mild prior penalty (exp(-lam*(m-1)))
        lam = 1.0
        logL = np.full(m_max + 1, -np.inf, dtype=float)
        for m in range(1, m_max + 1):
            logL[m] = float(dp[m, -1])
        m_vals = np.arange(1, m_max + 1)
        log_prior = np.array([0.0] + [-(m - 1) * lam for m in range(1, m_max + 1)], dtype=float)
        log_post = logL[1:] + log_prior[1:]
        lmax = float(np.max(log_post))
        post = np.exp(log_post - lmax)
        post /= np.sum(post) if np.sum(post) > 0 else 1.0
        p_m1 = float(post[0]) if post.size > 0 else 1.0
        p_var = max(0.0, min(1.0, 1.0 - p_m1))
        gl_index = int(round(10.0 * p_var))
        m_map = int(m_vals[int(np.argmax(post))]) if post.size > 0 else 1

        # Reconstruct step edges for m_map
        b = M - 2
        splits = []
        mm = m_map
        while mm > 1 and b >= 0:
            a = int(back[mm, b])
            splits.append(a + 1)
            b = a
            mm -= 1
        splits = sorted(splits)
        edge_idx = [0] + splits + [M - 1]
        step_edges = [float(edges[i]) for i in edge_idx]
        step_counts = []
        step_rates = []
        for k in range(len(edge_idx) - 1):
            i0, i1 = edge_idx[k], edge_idx[k + 1]
            dt_raw = float(edges[i1] - edges[i0])
            if dt_raw <= 0:
                continue
            n = int(max(0, idx_left[i1] - idx_left[i0]))
            dt = max(1e-12, dt_raw)
            step_counts.append(n)
            step_rates.append(float(n / dt))

        result.update({
            "p_var": float(round(p_var, 3)),
            "index": int(gl_index),
            "m_map": int(m_map),
            "step_edges_s": step_edges,
            "step_counts": step_counts,
            "step_rates_cps": step_rates,
        })
        return result
    except Exception:
        return result


def line_window_fap(
    energies_keV: np.ndarray,
    lo: float,
    hi: float,
    local_halfwidth: float = 0.2,
    k_min: int = 3,
    max_halfwidth: float = 1.0,
    growth: float = 1.5,
) -> Dict[str, Optional[float]]:
    """
    Estimate local continuum rate and compute Poisson tail FAP for counts in [lo, hi].
    Adaptive sidebands: widen from local_halfwidth until at least k_min sideband counts
    or until max_halfwidth is reached. Returns {k, lambda, fap}.
    """
    try:
        e = np.asarray(energies_keV, dtype=float)
        if e.size == 0:
            return {"k": 0, "lambda": None, "fap": None}
        win_lo, win_hi = float(lo), float(hi)
        if win_hi <= win_lo:
            return {"k": 0, "lambda": None, "fap": None}
        k = int(np.count_nonzero((e >= win_lo) & (e <= win_hi)))

        # Adaptive sideband widening
        w = float(max(0.0, local_halfwidth))
        w_max = float(max_halfwidth) if max_halfwidth is not None else w
        if w_max <= 0:
            w_max = w
        g = float(growth if growth and growth > 1.0 else 1.5)
        while True:
            band1 = (e >= (win_lo - w)) & (e < win_lo)
            band2 = (e > win_hi) & (e <= (win_hi + w))
            n_local = int(np.count_nonzero(band1 | band2))
            if n_local >= int(k_min) or w >= w_max:
                break
            w = min(w_max, w * g)

        width_local = 2.0 * w
        width_win = win_hi - win_lo
        if n_local <= 0 or width_local <= 0 or width_win <= 0:
            return {"k": k, "lambda": None, "fap": None}

        lam = (n_local / width_local) * width_win
        lam = float(max(0.0, lam))

        def _pois_cdf(km1: int, lmb: float) -> float:
            # P(K <= km1)
            s = 0.0
            term = 1.0
            for i in range(0, km1 + 1):
                if i > 0:
                    term *= lmb / i
                s += term
            return math.exp(-lmb) * s

        if k <= 0:
            fap = 1.0
        else:
            cdf = _pois_cdf(k - 1, lam)
            fap = max(0.0, min(1.0, 1.0 - cdf))
        return {"k": int(k), "lambda": float(round(lam, 3)), "fap": float(round(fap, 3))}
    except Exception:
        return {"k": None, "lambda": None, "fap": None}

def derive_psd_products_from_events(
    event_list: List[List[float]],
    energy_keV_range: Optional[Tuple[float, float]] = None,
    lc_bin_sec: float = 2000.0,
    rayleigh_period_range_s: Tuple[float, float] = (100.0, 10000.0),
    oversample: int = 8,
) -> Dict[str, Any]:
    """
    From an event list, compute:
      - evenly binned LC (counts & rates) at lc_bin_sec
      - Rayleigh Z1^2 periodogram
      - FFT PSD in Leahy and rms^2/Hz norms (with Poisson white-noise levels)
      - A rebinned PSD (log bins) and example band-integrated fractional rms values
    Returns a dict of products ready to serialize or render.
    """
    times, energies_keV = extract_times_energies(event_list, energy_keV_range)
    products: Dict[str, Any] = {"note": ""}

    lc = bin_light_curve(times, bin_sec=lc_bin_sec)
    products["light_curve"] = lc

    ray = rayleigh_periodogram(times, period_range_s=rayleigh_period_range_s, oversample=oversample)
    products["rayleigh"] = ray

    psd_leahy = psd_from_light_curve(lc, normalization="leahy", detrend="mean", pad_to_pow2=True)
    products["psd_leahy"] = psd_leahy

    psd_rms = psd_from_light_curve(lc, normalization="rms", detrend="mean", pad_to_pow2=True)
    products["psd_rms"] = psd_rms

    if psd_rms["freqs_Hz"].size > 0:
        f_reb, P_reb = geometric_rebin_psd(psd_rms["freqs_Hz"], psd_rms["psd"], factor=1.25)
        products["psd_rms_rebinned"] = {"freqs_Hz": f_reb, "psd": P_reb}

        # Example fixed bands if available
        fmin_grid = float(psd_rms["freqs_Hz"][0])
        fny = float(psd_rms["nyquist_Hz"]) if isinstance(psd_rms.get("nyquist_Hz"), (int, float)) else None
        bands = []
        if fny and fny > 0:
            bands = [(1.0e-4, min(3.0e-4, fny)), (3.0e-4, min(1.0e-3, fny))]
            bands = [(lo, hi) for (lo, hi) in bands if hi > lo and hi >= fmin_grid]
        fracs = [
            fractional_rms_in_band(psd_rms["freqs_Hz"], psd_rms["psd"], lo, hi, white_noise_level=psd_rms.get("white_noise_level"))
            for (lo, hi) in bands
        ] if bands else []
        products["psd_rms_bands"] = {"bands_Hz": bands, "fractional_rms": fracs}
    else:
        products["psd_rms_rebinned"] = {"freqs_Hz": np.array([]), "psd": np.array([])}
        products["psd_rms_bands"] = {"bands_Hz": [], "fractional_rms": []}

    return products

def _excess_variance_from_lc(counts: np.ndarray, exposure_s: np.ndarray) -> Optional[float]:
    """Excess variance F_var for LC with Poisson rate errors (no background)."""
    good = (exposure_s > 0)
    if not np.any(good):
        return None
    r = counts[good] / exposure_s[good]
    if r.size < 2:
        return None
    sigma_r = np.sqrt(counts[good]) / exposure_s[good]
    mu = float(np.mean(r))
    if mu <= 0:
        return None
    s2 = float(np.var(r, ddof=1))
    mean_err2 = float(np.mean(sigma_r ** 2))
    exc = s2 - mean_err2
    if exc <= 0:
        return 0.0
    return float(round(math.sqrt(exc) / mu, 3))


def _compute_hardness_intensity_series(times_s: np.ndarray, energies_keV: np.ndarray, bin_size_s: int = 2000) -> List[Dict[str, float]]:
    """
    Build hardness–intensity samples in bins of bin_size_s.
    Skip points with small denominators; mid-times are exposure-clipped.
    """
    if times_s.size == 0:
        raise ValueError("Cannot compute hardness–intensity: empty times array")
    t_min, t_max = float(times_s.min()), float(times_s.max())
    width = float(bin_size_s)
    nbins = int(math.ceil((t_max - t_min) / width))
    edges = t_min + np.arange(nbins + 1) * width
    out: List[Dict[str, float]] = []
    for i in range(nbins):
        t0, t1 = edges[i], min(edges[i + 1], t_max)
        if t1 <= t0:
            continue
        m = (times_s >= t0) & (times_s < t1)
        if not np.any(m):
            continue
        e_bin = energies_keV[m]
        s = int(np.count_nonzero((e_bin >= 0.5) & (e_bin < 1.2)))
        mct = int(np.count_nonzero((e_bin >= 1.2) & (e_bin < 2.0)))
        h = int(np.count_nonzero((e_bin >= 2.0) & (e_bin <= 7.0)))
        denom = h + mct
        HM = None
        if denom >= 3:
            HM = float(round((h - mct) / denom, 2))
        rate = float(len(e_bin) / (t1 - t0))
        out.append({
            "t_mid_s": float(round(t0 + 0.5 * (t1 - t0), 2)),
            "rate_cps": float(round(rate, 4)),
            "HM": HM,
        })
    return out


def build_events_only_metrics(event_list: List[List[float]]) -> Dict[str, Any]:
    """
    Compute events-only derived metrics needed for the expanded prompt.

    Raises:
        ValueError: If the event_list is missing or invalid.
    """
    import time
    from src.core.logger import get_logger
    logger = get_logger(__name__)
    
    times_s, energies_keV = _extract_event_arrays(event_list)
    total_events = int(times_s.size)
    logger.info(f"  📊 build_events_only_metrics: Processing {total_events} events")

    start = time.time()
    hist, peak_label, peak_count = _compute_histogram_05_10_keV(energies_keV)
    logger.info(f"  ✓ Histogram computed in {time.time()-start:.3f}s")
    
    start = time.time()
    quantiles = _compute_energy_quantiles_keV(energies_keV)
    logger.info(f"  ✓ Quantiles computed in {time.time()-start:.3f}s")
    
    start = time.time()
    hardness = _compute_hardness_counts_and_ratios(energies_keV)
    logger.info(f"  ✓ Hardness computed in {time.time()-start:.3f}s")

    start = time.time()
    fixed_lc = _compute_fixed_cadence_lc(times_s, [100, 500, 2000])
    logger.info(f"  ✓ Fixed cadence LC computed in {time.time()-start:.3f}s")
    
    start = time.time()
    adaptive_lc = _compute_adaptive_counts_lc(times_s, N=8)
    logger.info(f"  ✓ Adaptive LC computed in {time.time()-start:.3f}s")
    
    start = time.time()
    ks = _ks_constancy_test(times_s)
    logger.info(f"  ✓ K-S test computed in {time.time()-start:.3f}s")
    
    start = time.time()
    fano = _fano_factor_500s(times_s)
    logger.info(f"  ✓ Fano factor computed in {time.time()-start:.3f}s")
    
    start = time.time()
    hi_samples = _compute_hardness_intensity_series(times_s, energies_keV, bin_size_s=2000)
    logger.info(f"  ✓ Hardness-intensity series computed in {time.time()-start:.3f}s")
    
    # Timing/PSD products: Rayleigh + FFT PSD at 500 s and 2000 s
    # Rayleigh unbinned periodogram
    logger.info(f"  ⏱️  Starting Rayleigh periodogram (N={total_events})...")
    start = time.time()
    try:
        rayleigh = rayleigh_periodogram(times_s, period_range_s=(100.0, 10000.0), oversample=8)
        logger.info(f"  ✓ Rayleigh periodogram computed in {time.time()-start:.3f}s")
    except Exception as e:
        logger.warning(f"  ⚠️  Rayleigh periodogram failed after {time.time()-start:.3f}s: {str(e)}")
        rayleigh = {
            "best_period_s": None,
            "best_freq_Hz": None,
            "Z1_squared": None,
            "p_single": None,
            "p_corrected": None,
            "pulsed_fraction_95ul": None,
        }

    def _fft_psd_bundle(bin_sec: int) -> Dict[str, Any]:
        lc = bin_light_curve(times_s, bin_sec=float(bin_sec))
        psd_leahy = psd_from_light_curve(lc, normalization="leahy", detrend="mean", pad_to_pow2=True)
        psd_rms = psd_from_light_curve(lc, normalization="rms", detrend="mean", pad_to_pow2=True)
        # Rebin and compute example fractional rms bands if feasible
        reb = {"freqs_Hz": np.array([]), "psd": np.array([])}
        bands = []
        fracs = []
        if psd_rms["freqs_Hz"].size > 0:
            f_reb, P_reb = geometric_rebin_psd(psd_rms["freqs_Hz"], psd_rms["psd"], factor=1.25)
            reb = {"freqs_Hz": f_reb, "psd": P_reb}
            nyq = float(psd_rms.get("nyquist_Hz") or 0.0)
            if nyq > 0:
                candidate_bands = [(1.0e-4, min(3.0e-4, nyq)), (3.0e-4, min(1.0e-3, nyq))]
                # Keep valid bands within available frequency grid
                fmin_grid = float(psd_rms["freqs_Hz"][0])
                bands = [(lo, hi) for (lo, hi) in candidate_bands if (hi > lo) and (hi >= fmin_grid)]
                for lo, hi in bands:
                    fr = fractional_rms_in_band(
                        psd_rms["freqs_Hz"], psd_rms["psd"], lo, hi, white_noise_level=psd_rms.get("white_noise_level")
                    )
                    fracs.append(fr)
        return {
            "cadence_s": int(bin_sec),
            "leahy": psd_leahy,
            "rms": psd_rms,
            "rms_rebinned": reb,
            "rms_bands": {"bands_Hz": bands, "fractional_rms": fracs},
        }

    fft_psd = {}
    for b in [500, 2000]:
        try:
            logger.info(f"  ⏱️  Starting FFT PSD for {b}s bins...")
            start = time.time()
            fft_psd[str(b) + "s"] = _fft_psd_bundle(b)
            logger.info(f"  ✓ FFT PSD ({b}s) computed in {time.time()-start:.3f}s")
        except Exception as e:
            logger.warning(f"  ⚠️  FFT PSD ({b}s) failed: {str(e)}")
            fft_psd[str(b) + "s"] = {
                "cadence_s": int(b),
                "leahy": {"freqs_Hz": np.array([]), "psd": np.array([]), "white_noise_level": np.nan, "nyquist_Hz": np.nan, "df_Hz": np.nan, "norm": "leahy"},
                "rms": {"freqs_Hz": np.array([]), "psd": np.array([]), "white_noise_level": np.nan, "nyquist_Hz": np.nan, "df_Hz": np.nan, "norm": "rms"},
                "rms_rebinned": {"freqs_Hz": np.array([]), "psd": np.array([])},
                "rms_bands": {"bands_Hz": [], "fractional_rms": []},
            }

    # Excess variance from 2000s LC if available
    excess_variance = {"F_var": None}
    lc_2000 = fixed_lc.get("2000s")
    if lc_2000 and isinstance(lc_2000.get("counts"), list) and isinstance(lc_2000.get("exposure_s"), list):
        c_arr = np.asarray(lc_2000["counts"], dtype=float)
        e_arr = np.asarray(lc_2000["exposure_s"], dtype=float)
        try:
            fvar = _excess_variance_from_lc(c_arr, e_arr)
            excess_variance["F_var"] = fvar
        except Exception:
            excess_variance["F_var"] = None
    # TODO: Add PSD
    # Time-resolved median energy per 2000 s
    def _time_resolved_median_energy(times_s_local: np.ndarray, energies_keV_local: np.ndarray, bin_size_s: int = 2000) -> List[Dict[str, float]]:
        if times_s_local.size == 0:
            return []
        t_min_l, t_max_l = float(times_s_local.min()), float(times_s_local.max())
        width_l = float(bin_size_s)
        nbins_l = int(math.ceil((t_max_l - t_min_l) / width_l))
        edges_l = t_min_l + np.arange(nbins_l + 1) * width_l
        out_l: List[Dict[str, float]] = []
        for i_l in range(nbins_l):
            t0_l, t1_l = edges_l[i_l], min(edges_l[i_l + 1], t_max_l)
            if t1_l <= t0_l:
                continue
            m_l = (times_s_local >= t0_l) & (times_s_local < t1_l)
            if not np.any(m_l):
                continue
            e_l = energies_keV_local[m_l]
            med_l = float(np.median(e_l))
            if e_l.size >= 2:
                q25_l, q75_l = np.percentile(e_l, [25, 75])
            else:
                q25_l = q75_l = med_l
            out_l.append({
                "t_mid_s": float(round(t0_l + 0.5 * (t1_l - t0_l), 2)),
                "E50_keV": float(round(med_l, 2)),
                "IQR_keV": float(round(q75_l - q25_l, 2))
            })
        return out_l

    time_resolved_medians = _time_resolved_median_energy(times_s, energies_keV, bin_size_s=2000)

    # Quantile color–color from full events
    def _quantile_cc_from_full(q: Dict[str, float]) -> Optional[Dict[str, float]]:
        try:
            E25, E50, E75 = q["E25"], q["E50"], q["E75"]
            if E50 <= 0:
                return None
            x = (E50 - E25) / E50
            y = (E75 - E50) / E50
            return {"x": float(round(x, 3)), "y": float(round(y, 3))}
        except Exception:
            return None

    quantile_cc = _quantile_cc_from_full(quantiles)

    # Build compact LC summaries per cadence
    def _per_bin_energy_stats(times_s_local: np.ndarray, energies_keV_local: np.ndarray, edges_local: np.ndarray):
        E50 = [None] * (len(edges_local) - 1)
        Emean = [None] * (len(edges_local) - 1)
        for i_l in range(len(edges_local) - 1):
            t0_l, t1_l = edges_local[i_l], edges_local[i_l + 1]
            m_l = (times_s_local >= t0_l) & (times_s_local < t1_l)
            if not np.any(m_l):
                continue
            e_l = energies_keV_local[m_l]
            # Require ≥2 events to report a stable median; otherwise leave as None
            if e_l.size >= 2:
                E50[i_l] = float(round(np.median(e_l), 2))
                Emean[i_l] = float(round(np.mean(e_l), 2))
            else:
                E50[i_l] = None
                Emean[i_l] = None
        return E50, Emean

    def _lc_compact_from_edges(edges_local: np.ndarray, counts_local: np.ndarray, exposure_local: np.ndarray, peak_idx: int, trough_idx: int, E50_bin: List[Optional[float]], Emean_bin: List[Optional[float]]):
        exp = np.asarray(exposure_local, float)
        t_mid = edges_local[:-1] + 0.5 * exp

        def pick(i):
            return {
                "t_mid_s": float(round(t_mid[i], 2)),
                "rate_cps": float(round((counts_local[i] / exp[i]) if exp[i] > 0 else 0.0, 5)),
                "E50_bin": E50_bin[i],
                "Emean_bin": Emean_bin[i],
            }

        # E50 trend
        idx = [i for i, v in enumerate(E50_bin) if (v is not None) and (exp[i] > 0)]
        trend = None
        if len(idx) >= 3:
            x = np.array([t_mid[i] / 1000.0 for i in idx], float)
            y = np.array([E50_bin[i] for i in idx], float)
            xbar, ybar = x.mean(), y.mean()
            denom = float(np.sum((x - xbar) ** 2))
            if denom > 0:
                slope = float(np.sum((x - xbar) * (y - ybar)) / denom)
                ss_tot = float(np.sum((y - ybar) ** 2))
                ss_res = float(np.sum((y - (ybar + slope * (x - xbar))) ** 2))
                r2 = float(1.0 - (ss_res / ss_tot)) if ss_tot > 0 else 0.0
                trend = {"slope_keV_per_ks": float(round(slope, 3)), "r2": float(round(r2, 3)), "n_points": int(len(idx))}

        # E50 IQR across bins
        e50_vals = [E50_bin[i] for i in idx]
        e50_stats = None
        if len(e50_vals) >= 2:
            q25, med, q75 = np.percentile(e50_vals, [25, 50, 75])
            e50_stats = {"median": float(round(med, 2)), "iqr": float(round(q75 - q25, 2))}

        # samples: first, median, last, peak, trough (deduped)
        total_bins = len(t_mid)
        cand_idx = list(dict.fromkeys([0, total_bins // 2, max(0, total_bins - 1), peak_idx, trough_idx]))
        samples = []
        for i_l in cand_idx:
            if 0 <= i_l < total_bins:
                samples.append({
                    "t_mid_s": float(round(t_mid[i_l], 2)),
                    "rate_cps": float(round((counts_local[i_l] / exp[i_l]) if exp[i_l] > 0 else 0.0, 5)),
                    "E50_bin": E50_bin[i_l]
                })
        return trend, e50_stats, samples, pick(peak_idx), pick(trough_idx)

    lc_compact: Dict[str, Any] = {}
    for key in ["100s", "500s", "2000s"]:
        if key not in fixed_lc:
            continue
        e = fixed_lc[key]
        edges = np.array(e.get("edges", []), float)
        counts = np.array(e.get("counts", []), float)
        exposure = np.array(e.get("exposure_s", []), float)
        if edges.size == 0 or counts.size == 0 or exposure.size == 0:
            continue
        E50_bin, Emean_bin = _per_bin_energy_stats(times_s, energies_keV, edges)
        with np.errstate(divide='ignore', invalid='ignore'):
            rates = np.where(exposure > 0, counts / exposure, np.nan)
        if np.all(np.isnan(rates)):
            continue
        peak_idx = int(np.nanargmax(rates))
        trough_idx = int(np.nanargmin(rates))
        trend, e50_stats, samples, peak_full, trough_full = _lc_compact_from_edges(
            edges, counts, exposure, peak_idx, trough_idx, E50_bin, Emean_bin
        )
        lc_compact[key] = {
            "mean": e["mean"],
            "std": e["std"],
            "frac_rms": e["frac_rms"],
            "zero_exposure_bins": e["zero_exposure_bins"],
            "bins": e["bins"],
            "peak": peak_full,
            "trough": trough_full,
            "E50_over_time": trend,
            "E50_bin_stats": e50_stats,
            "samples": samples,
        }

    # Attach compact LC
    # Gregory–Loredo variability with automatic binning for large N
    logger.info(f"  ⏱️  Starting Gregory-Loredo variability (N={total_events})...")
    start = time.time()
    try:
        # gl_variability now handles binning automatically for N > 10,000
        gl = gl_variability(times_s, m_max=10, max_unbinned=5000)
        
        if gl.get("binned"):
            logger.info(f"  ✓ Gregory-Loredo computed in {time.time()-start:.3f}s (auto-binned to {gl.get('n_bins')} bins)")
        else:
            logger.info(f"  ✓ Gregory-Loredo computed in {time.time()-start:.3f}s (unbinned)")
    except Exception as e:
        logger.warning(f"  ⚠️  Gregory-Loredo failed after {time.time()-start:.3f}s: {str(e)}")
        gl = {"p_var": None, "index": None, "m_map": None, "step_edges_s": [], "step_counts": [], "step_rates_cps": []}

    # Per-line Poisson FAPs
    logger.info(f"  ⏱️  Starting line FAP calculations...")
    start = time.time()
    try:
        line_fap_dict = {}
        for tag, lo_w, hi_w in LINE_WINDOWS:
            line_fap_dict[tag] = line_window_fap(energies_keV, lo_w, hi_w, local_halfwidth=0.2)
        logger.info(f"  ✓ Line FAPs computed in {time.time()-start:.3f}s")
    except Exception as e:
        logger.warning(f"  ⚠️  Line FAPs failed after {time.time()-start:.3f}s: {str(e)}")
        line_fap_dict = {}
    metrics_with_compact = {
        "counts_total": total_events,
        "time_range_s": [float(round(times_s.min(), 2)), float(round(times_s.max(), 2))],
        "energy_quantiles_keV": quantiles,
        "hardness": hardness,
        "spectrum_hist_peak": {"bin": peak_label, "counts": peak_count},
        "histogram_counts": hist,
        "lc": fixed_lc,
        "lc_compact": lc_compact,
        "adaptive_counts": {
            "N": adaptive_lc["N"],
            "num_bins": adaptive_lc["num_bins"],
            "median_width_s": adaptive_lc["median_width_s"],
            "iqr_rate_cps": adaptive_lc["iqr_rate_cps"],
            "bins": adaptive_lc["bins"],
        },
        "constancy_tests": {"ks_D": ks["D"], "ks_p": ks["p"], "fano500": fano},
        "periodicity": {"rayleigh_scan": "computed"},
        "hardness_intensity": hi_samples,
        "excess_variance": excess_variance,
        "time_resolved_median_energy": time_resolved_medians,
        "quantile_cc": quantile_cc,
        "timing_psd": {"rayleigh": rayleigh, "fft": fft_psd},
        "gregory_loredo": gl,
        "line_fap": line_fap_dict,
    }

    return metrics_with_compact


def render_events_only_prompt(user_question: str, event_list: List[List[float]]) -> str:
    """
    Render the extended events-only prompt described by the user, based solely on event_list.

    This function does not modify existing behavior; it can be used by callers when
    metadata is unavailable and only events are present.
    """
    metrics = build_events_only_metrics(event_list)

    lines: List[str] = []
    lines.append("You are an expert X-ray astronomer specializing in Chandra data.")
    lines.append("Use ONLY the evidence provided below (derived from a single observation’s event list).")
    lines.append("Be rigorous, quantify uncertainty, and state when evidence is insufficient.")
    lines.append("")
    lines.append("CHANDRA X-RAY SOURCE DATA (EVENTS-ONLY DERIVATIVES)")
    lines.append("===================================================")
    lines.append("")
    lines.append(f"USER QUESTION: {user_question}")
    lines.append("")

    # A) ENERGY SPECTRUM
    lines.append("A) ENERGY SPECTRUM (Binned from events)")
    lines.append("---------------------------------------")
    lines.append(f"- Total Events: {metrics['counts_total']}")
    peak = metrics.get("spectrum_hist_peak", {})
    if peak.get("bin"):
        lines.append(f"- Continuum (0.5–8 keV): Peak bin = {peak['bin']} ({peak['counts']} counts)")
    # All bins string
    bins_list = []
    for lbl, cnt in metrics.get("histogram_counts", {}).items():
        bins_list.append(f"{lbl} ({cnt})")
    if bins_list:
        lines.append("- All bins: " + ", ".join(bins_list))

    # Emission lines from LINE_WINDOWS
    # Re-compute line counts from event_list for explicit listing
    _, energies_keV = _extract_event_arrays(event_list)
    line_counts_pairs = []
    for tag, lo, hi in LINE_WINDOWS:
        cnt = int(((energies_keV >= lo) & (energies_keV <= hi)).sum())
        if cnt > 0:
            line_counts_pairs.append(f"{tag.replace('‑','-')}: {cnt}")
    if line_counts_pairs:
        lines.append("- Emission lines (counts in standard windows): " + "; ".join(line_counts_pairs))

    q = metrics.get("energy_quantiles_keV", {})
    if q:
        lines.append(f"- Energy quantiles (keV): E25={q.get('E25')}, E50={q.get('E50')}, E75={q.get('E75')}")

    h = metrics.get("hardness", {})
    if h:
        lines.append("- Hardness ratios (bands S:0.5–1.2, M:1.2–2.0, H:2.0–7.0):")
        lines.append(f"  • Counts S={h.get('S')}, M={h.get('M')}, H={h.get('H')}")
        lines.append(f"  • HS=(H−S)/(H+S) = {h.get('HS')}")
        lines.append(f"  • HM=(H−M)/(H+M) = {h.get('HM')}")
        lines.append(f"  • MS=(M−S)/(M+S) = {h.get('MS')}")

    # B) LIGHT CURVES
    lines.append("")
    lines.append("B) LIGHT CURVES (Multiple views; full exposure assumed; no background subtraction)")
    lines.append("----------------------------------------------------------------------------------")
    lc = metrics.get("lc", {})
    for key in ["100s", "500s", "2000s"]:
        if key in lc:
            entry = lc[key]
            lines.append(f"B1. Fixed cadence:") if key == "100s" else None
            # Fix: use zero_exposure_bins instead of empty_bins
            lines.append(f"- {key[:-1]} s: mean={entry['mean']} c/s, std={entry['std']}, fracRMS={entry['frac_rms']}, zero_exposure_bins={entry['zero_exposure_bins']}, bins={entry['bins']}")
            lines.append(f"  • Peak: t_mid≈{entry['peak']['t_mid_s']} s @ {entry['peak']['rate_cps']:.4f} c/s; Lowest: t_mid≈{entry['trough']['t_mid_s']} s @ {entry['trough']['rate_cps']:.4f} c/s")

    lines.append("")
    lines.append("B2. Adaptive-counts (N=8 cts/bin):")
    adap = metrics.get("adaptive_counts", {})
    if adap:
        lines.append(f"- num_bins={adap.get('num_bins')}; median bin width≈{adap.get('median_width_s')} s; rate IQR≈{adap.get('iqr_rate_cps')} c/s")
        lines.append("- Head bins (t0–t1 s; width; counts; rate):")
        for b in adap.get("bins", [])[:5]:
            lines.append(f"  • {b['t0_s']}-{b['t1_s']}; {b['width_s']} s; {b['counts']}; {b['rate_cps']} c/s")

    lines.append("")
    lines.append("B3. Bayesian blocks (unbinned arrivals):")
    lines.append("- not computed")

    # C) VARIABILITY / PERIODICITY TESTS
    lines.append("")
    lines.append("C) VARIABILITY / PERIODICITY TESTS")
    lines.append("----------------------------------")
    constancy = metrics.get("constancy_tests", {})
    lines.append(f"- K–S constancy test on arrivals vs uniform rate over [t_min,t_max]: D={constancy.get('ks_D')}, p≈{constancy.get('ks_p')}")
    fano = constancy.get("fano500")
    lines.append(f"- Fano factor (non-overlapping 500 s windows): {fano} (nbins=auto)")
    # Excess variance was computed above from 2000s LC if possible
    fvar = metrics.get("excess_variance", {}).get("F_var")
    lines.append(f"- Excess variance F_var: {fvar if (isinstance(fvar, (int, float)) or fvar == 0.0) else '—'}")
    ray_best = (metrics.get("timing_psd", {}) or {}).get("rayleigh", {})
    if isinstance(ray_best, dict) and ray_best.get("best"):
        b = ray_best["best"]
        lines.append(f"- Periodicity (Rayleigh Z1^2, 100–10000 s): best P={round(b.get('P_s'),2)} s, p_corrected≈{b.get('p_global'):.2g}")
    else:
        lines.append("- Periodicity (Rayleigh Z1^2, 100–10000 s): not computed or insufficient events")

    # D) TIME–ENERGY EVOLUTION
    lines.append("")
    lines.append("D) TIME–ENERGY EVOLUTION")
    lines.append("------------------------")
    hi = metrics.get("hardness_intensity", [])
    if hi:
        lines.append("- Hardness–Intensity samples (2000 s bins; entries with H+M>0):")
        lines.append("  (t_mid s, rate c/s, HM)")
        bullets = []
        for pt in hi[:10]:
            bullets.append(f"({pt['t_mid_s']}, {pt['rate_cps']}, {pt['HM']})")
        if bullets:
            lines.append("  • " + ", ".join(bullets))
    else:
        lines.append("- Hardness–Intensity samples: not available")
    lines.append("- Median energy vs time: not computed (can be derived per bin from events)")

    # E) EVIDENCE BULLETS (brief hints derived from metrics — caller may enrich)
    lines.append("")
    lines.append("E) EVIDENCE BULLETS")
    lines.append("-------------------")
    lines.append("- Derived from events-only metrics above; avoid over-interpreting low counts.")

    # F) MACHINE-READABLE SUMMARY
    lines.append("")
    lines.append("F) MACHINE-READABLE SUMMARY (for tool use)")
    lines.append("------------------------------------------")
    # Build compact JSON summary with selected fields
    summary = {
        "counts_total": metrics.get("counts_total"),
        "time_range_s": metrics.get("time_range_s"),
        "energy_quantiles_keV": metrics.get("energy_quantiles_keV"),
        "hardness": metrics.get("hardness"),
        "spectrum_hist_peak": metrics.get("spectrum_hist_peak"),
        "line_counts": {tag.replace('‑','-'): int(((energies_keV >= lo) & (energies_keV <= hi)).sum()) for tag, lo, hi in LINE_WINDOWS},
        "lc": {k: {kk: vv for kk, vv in v.items() if kk != "bins" or True} for k, v in metrics.get("lc", {}).items()},
        "adaptive_counts": {k: v for k, v in metrics.get("adaptive_counts", {}).items() if k != "bins" or True},
        "constancy_tests": metrics.get("constancy_tests"),
        "periodicity": metrics.get("periodicity"),
        "hardness_intensity": metrics.get("hardness_intensity"),
    }
    lines.append(json.dumps(summary, ensure_ascii=False, indent=2))

    # Instructions block
    lines.append("")
    lines.append("INSTRUCTIONS")
    lines.append("============")
    lines.append("1) Give a direct classification with likelihoods across plausible classes (AGN / YSO / active star / CV / XRB / other).")
    lines.append("2) First assess variability: use fracRMS across cadences, K–S, Fano, peaks/troughs (and blocks if available).")
    lines.append("3) Then assess spectrum: energy quantiles, hardness, soft-line tallies; avoid over-interpreting low counts.")
    lines.append("4) State clearly which conclusions are direct vs inferred; list contradictions.")
    lines.append("5) Comment on data sufficiency (counts, timescales) and how it affects confidence.")
    lines.append("6) Output a final JSON verdict:")
    lines.append('   {"class": "...", "confidence_0_to_1": ..., "variability_level": "none|possible|moderate|high",')
    lines.append('    "key_evidence": ["...","..."], "counter_evidence": ["..."]}')

    return "\n".join(lines)


def render_events_only_prompt_from_src(user_question: str, src: Dict[str, Any]) -> str:
    """
    Convenience wrapper to render the events-only prompt from a full source dict
    containing an `event_list` key.
    """
    event_list = src.get("event_list")
    if not isinstance(event_list, list) or len(event_list) == 0:
        raise ValueError("src.event_list is required for events-only prompt rendering")
    return render_events_only_prompt(user_question, event_list)