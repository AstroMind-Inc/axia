import gzip
import io
import json
import logging
import tarfile
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

import numpy as np
import pyvo
import requests
from astropy.io import fits

logger = logging.getLogger(__name__)


def fetch_event_lists_for_source(
    obsid: int,
    source_name: str,
    min_sig: float = 5.0,
    max_theta: float = 10.0,
    version: str = "rel2.1",
) -> Dict[Tuple[int, int, int], np.ndarray]:
    """
    Fetch source-region event lists for a given (obsid, source_name) from CSC 2.1.

    Returns
    -------
    Dict[(obsid, obi, region_id), np.ndarray]
        Each value is an array of shape (N_events, 2) with columns:
        [time [s], energy [eV]] taken from the regevt3.fits EVENTS table.

    Notes
    -----
    - Uses CSC 2.1 TAP at http://cda.cfa.harvard.edu/csc21tap
    - Uses CSC CLI HTTP endpoint at http://cda.cfa.harvard.edu/csccli/retrieve
      to download the source-region event file (regevt3.fits). :contentReference[oaicite:0]{index=0}
    - Filters detections by:
        * obsid
        * source_name (m.name)
        * instrument = 'ACIS'
        * flux_significance_b >= min_sig
        * theta <= max_theta
    """
    # 1) Find the detections for this (obsid, source_name) via TAP
    tap = pyvo.dal.TAPService("http://cda.cfa.harvard.edu/csc21tap")

    # Escape any single quotes in the name for ADQL
    src_name = source_name.replace("'", "''")

    adql = f"""
        SELECT DISTINCT o.obsid, o.obi, o.region_id
        FROM csc21.master_source m,
             csc21.master_stack_assoc a,
             csc21.observation_source o,
             csc21.stack_observation_assoc b,
             csc21.stack_source s
        WHERE (m.name = '{src_name}')
          AND (m.name = a.name)
          AND (a.match_type = 'u')
          AND (s.detect_stack_id = a.detect_stack_id AND s.region_id = a.region_id)
          AND (s.detect_stack_id = b.detect_stack_id AND s.region_id = b.region_id)
          AND (o.obsid = b.obsid AND o.obi = b.obi AND o.region_id = b.region_id)
          AND (o.instrument = 'ACIS')
          AND (o.obsid = {obsid})
        ORDER BY o.obsid, o.obi, o.region_id
    """

    logger.info(
        "Querying CSC detections for obsid=%s name='%s' (min_sig=%s max_theta=%s)",
        obsid,
        source_name,
        min_sig,
        max_theta,
    )
    cat = tap.search(adql)
    table = cat.to_table()
    logger.info("Found %s matching detections", len(table))

    if len(table) == 0:
        raise ValueError(
            f"No CSC detections found for obsid={obsid}, name='{source_name}' "
            f"(min_sig={min_sig}, max_theta={max_theta})."
        )

    # 2) For each detection, download regevt3.fits via CSC CLI and extract [time, energy]
    url = "http://cda.cfa.harvard.edu/csccli/retrieve"
    results: Dict[Tuple[int, int, int], np.ndarray] = {}

    for idx, row in enumerate(table, start=1):
        o_obsid = int(row["obsid"])
        obi = int(row["obi"])
        region_id = int(row["region_id"])

        det_id = f"{o_obsid}.{obi}.{region_id}"
        logger.info(
            "[%s/%s] Downloading regevt3 package for detection %s",
            idx,
            len(table),
            det_id,
        )
        params = {
            "version": version,
            "packageset": f"{det_id}/regevt3/b",
        }

        resp = requests.get(url, params=params)
        resp.raise_for_status()
        logger.debug(
            "[%s/%s] Retrieved %s bytes for detection %s",
            idx,
            len(table),
            len(resp.content),
            det_id,
        )

        # The response is a tar file; find the *regevt3.fits member
        tar_bytes = io.BytesIO(resp.content)
        with tarfile.open(fileobj=tar_bytes, mode="r:*") as tf:
            member = None
            for m in tf.getmembers():
                if m.name.endswith("regevt3.fits") or m.name.endswith(
                    "regevt3.fits.gz"
                ):
                    member = m
                    break

            if member is None:
                raise RuntimeError(
                    f"No regevt3.fits found in tarball for detection {det_id}"
                )

            with tf.extractfile(member) as fobj:
                raw_bytes = fobj.read()
                if member.name.endswith(".gz"):
                    logger.debug(
                        "[%s/%s] Decompressing gzip member %s",
                        idx,
                        len(table),
                        member.name,
                    )
                    raw_bytes = gzip.decompress(raw_bytes)
                fits_bytes = io.BytesIO(raw_bytes)
                with fits.open(fits_bytes, memmap=False) as hdul:
                    events = hdul[1].data
                    # TIME and ENERGY columns (seconds, eV) :contentReference[oaicite:1]{index=1}
                    times = np.asarray(events["time"], dtype=float)
                    energies = np.asarray(events["energy"], dtype=float)
                    event_list = np.column_stack([times, energies])
                    results[(o_obsid, obi, region_id)] = event_list
                    logger.info(
                        "[%s/%s] Detection %s -> %s events",
                        idx,
                        len(table),
                        det_id,
                        event_list.shape[0],
                    )

    return results


def _flatten_event_lists(event_lists: Iterable[np.ndarray]) -> np.ndarray:
    stacked: List[np.ndarray] = [arr for arr in event_lists if arr.size > 0]
    if not stacked:
        return np.empty((0, 2), dtype=float)
    if len(stacked) == 1:
        return stacked[0]
    return np.concatenate(stacked, axis=0)


def process_sources(input_path: Path, output_path: Path) -> List[Dict[str, object]]:
    with input_path.open("r", encoding="utf-8") as f:
        entries = json.load(f)

    if not isinstance(entries, list):
        raise ValueError(f"Expected list in {input_path}, got {type(entries).__name__}")

    output_data = []
    failures: List[Dict[str, object]] = []
    for idx, entry in enumerate(entries, start=1):
        logger.info("[%s/%s] Processing %s", idx, len(entries), entry)

        try:
            obsid = int(entry["obsid"])
            source_name = entry["source_name"]
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"Invalid entry at index {idx}: {entry}") from exc

        try:
            result_map = fetch_event_lists_for_source(obsid, source_name)
        except (ValueError, RuntimeError, requests.HTTPError) as exc:
            logger.warning(
                "[%s/%s] Failed to fetch events for obsid=%s name='%s': %s",
                idx,
                len(entries),
                obsid,
                source_name,
                exc,
            )
            failures.append(
                {
                    "obsid": obsid,
                    "source_name": source_name,
                    "error": str(exc),
                }
            )
            continue

        flattened = _flatten_event_lists(result_map.values())
        logger.info(
            "[%s/%s] obsid=%s name='%s' -> %s detections, %s events",
            idx,
            len(entries),
            obsid,
            source_name,
            len(result_map),
            flattened.shape[0],
        )

        output_data.append(
            {
                "obsid": obsid,
                "source_name": source_name,
                "event_list": flattened.tolist(),
            }
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(output_data, f, indent=2)

    logger.info("Wrote %s entries to %s", len(output_data), output_path)
    if failures:
        logger.warning(
            "Completed with %s failures (will print list below)", len(failures)
        )
    else:
        logger.info("Completed with no failures")

    return failures



if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    base_dir = Path(__file__).resolve().parent
    input_file = base_dir / "input.json"
    output_file = base_dir / "output.json"

    failures = process_sources(input_file, output_file)
    if failures:
        print("Failed entries:")
        print(json.dumps(failures, indent=2))