"""Preprocessing utilities — verbatim from model/server/base_functions.py.

Only source_to_xray_tensors and prune are included; no LLM / training code.
"""

import numpy as np
from scipy import stats as sstats
from typing import List, Tuple, Optional


def source_to_xray_tensors(events, stats: dict, max_events: int = 512):
    """Convert one observation's photon list into the tensors required by XrayProcessor."""
    EPS = 1e-8
    events = np.asarray(sorted(events, key=lambda x: x[0]), dtype=np.float32)

    if events.size == 0:
        raise ValueError("event_list is empty for source")

    t = events[:, 0]
    E_eV = events[:, 1]
    E_keV = E_eV * 1e-3

    duration = max(t[-1] - t[0], EPS)
    rel_t = (t - t[0]) / duration
    dt = np.diff(t, prepend=t[0])
    log_dt = np.log1p(dt)

    logE = np.log10(E_eV + 1.0)
    logE_z = (logE - stats["logE_mean"]) / stats["logE_std"]

    E_q = sstats.rankdata(E_eV) / len(E_eV)
    abs_t = (t - t[0]) * stats["abs_t_scale"]

    per_event = np.stack([rel_t, abs_t, log_dt, logE_z, E_q], axis=1)

    valid_len = len(per_event)
    event_mask = np.zeros(max_events, dtype=bool)
    event_mask[: min(valid_len, max_events)] = True

    if valid_len < max_events:
        pad = np.zeros((max_events - valid_len, 5), dtype=np.float32)
        per_event = np.vstack([per_event, pad])
    else:
        per_event = per_event[:max_events]

    per_event = per_event.astype(np.float32)

    log_dur = np.log10(duration + 1.0)
    rate_ksec = (valid_len / duration) * 1e3

    soft = np.count_nonzero(E_keV < 2.0)
    hard = np.count_nonzero((E_keV >= 2.0) & (E_keV < 7.0))
    HR = (hard - soft) / (hard + soft) if (soft + hard) else 0.0

    meta_token = np.asarray([log_dur, rate_ksec, HR], dtype=np.float32)

    spec_edges = np.asarray(stats["spec_edges_keV"], dtype=np.float32)
    counts, _ = np.histogram(E_keV, bins=spec_edges)
    counts = counts / (duration / 1_000.0)
    spec_vec = np.log1p(counts).astype(np.float32)

    freq = np.asarray(stats["psd_freq_hz"], dtype=np.float32)
    tau = t - t[0]
    sin = np.sin(2 * np.pi * freq[:, None] * tau)
    cos = np.cos(2 * np.pi * freq[:, None] * tau)
    power = 2.0 / len(tau) * (sin.sum(1) ** 2 + cos.sum(1) ** 2)
    psd_vec = np.log1p(power).astype(np.float32)

    return {
        "per_event": per_event.tolist(),
        "event_mask": event_mask.tolist(),
        "meta_token": meta_token.tolist(),
        "spec_vec": spec_vec.tolist(),
        "psd_vec": psd_vec.tolist(),
    }


def prune(
    event_list, T: int = 28800
) -> Tuple[Optional[np.ndarray], List[str]]:
    """Prune a single event list to the analysis window [0, T]."""
    try:
        arr = np.asarray(event_list, dtype=float)
    except Exception as e:
        return None, [f"event list is invalid - cannot convert to numeric Nx2 array: {e}"]

    if arr.ndim != 2 or arr.shape[1] != 2 or arr.shape[0] == 0:
        return None, [f"event list is invalid - expected Nx2 array with >0 rows, got shape {arr.shape}"]

    if not np.isfinite(arr).all():
        bad = np.size(arr) - np.isfinite(arr).sum()
        return None, [f"event list is invalid - contains {bad} NaN/inf values"]

    arr = arr.copy()
    t_min = float(np.min(arr[:, 0]))
    arr[:, 0] = arr[:, 0] - t_min

    e_max = float(np.nanmax(arr[:, 1]))
    if e_max <= 20.0:
        emin, emax = 0.5, 7.0
    else:
        emin, emax = 500.0, 7000.0

    n_before = arr.shape[0]
    mask = (arr[:, 1] >= emin) & (arr[:, 1] <= emax)
    arr = arr[mask]
    if arr.size == 0:
        return None, [
            f"event list is invalid - no events in the required energy window "
            f"[{emin}, {emax}] (had {n_before} events before filtering)"
        ]

    if arr[-1, 0] < T:
        exp_hours = T / 3600.0
        got_hours = float(np.max(arr[:, 0])) / 3600.0
        return None, [
            "event list is invalid - not enough seconds recorded for the analysis window",
            f"required duration: >= {exp_hours:.2f} hours (T={T} s); available after energy filter: {got_hours:.2f} hours",
        ]

    arr = arr[arr[:, 0] <= T]
    if arr.shape[0] < 2:
        return None, [
            f"event list is invalid - not enough events after clipping to first {T} s",
            f"events remaining: {arr.shape[0]}",
        ]

    dt = arr[1, 0] - arr[0, 0]
    if dt > 0:
        shift = float(np.random.uniform(0.0, dt))
        arr[:, 0] = arr[:, 0] + shift
        arr = arr[arr[:, 0] <= T]

    if arr.shape[0] < 2:
        return None, [
            "event list is invalid - too few events after boundary shift and clipping",
            f"events remaining: {arr.shape[0]}",
        ]

    return arr, []
