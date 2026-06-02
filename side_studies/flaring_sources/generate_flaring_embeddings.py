#!/usr/bin/env python3
"""
Script to generate embeddings for flaring source PLLM agent outputs and OpenAI direct outputs.

Joins:
  - flaring_output_results_0_25.json  (event_analysis, metadata_analysis,
                                       neighbor_analysis, final_answer)
  - flaring_openai_results_0_25.json  (final_answer as open_ai_only)

on source_id (intersection only) and produces one embedding per text field
using text-embedding-ada-002.

All output records include has_flare=True since these are known flaring sources.

Output schema per record:
{
    "source_id": "...",
    "source_name": "...",
    "obsid": ...,
    "has_flare": true,

    "pllm_event_analyst": "<text>",
    "pllm_event_analyst_embeddings": [...],

    "pllm_metadata_analyst": "<text>",
    "pllm_metadata_analyst_embeddings": [...],

    "pllm_neighbor_analyst": "<text>",
    "pllm_neighbor_analyst_embeddings": [...],

    "pllm_full": "<text>",
    "pllm_full_embeddings": [...],

    "open_ai_only": "<text>",
    "open_ai_only_embeddings": [...]
}
"""

import json
import os
import sys
import argparse
from typing import Dict, List, Any, Optional
from openai import OpenAI

# ── Configuration ─────────────────────────────────────────────────────────────
PLLM_FILE   = "flaring_output_results_0_25.json"
OPENAI_FILE = "flaring_openai_results_0_25.json"
OUTPUT_FILE = "flaring_agent_embeddings.json"

EMBEDDING_MODEL = "text-embedding-ada-002"

START_INDEX = 0
END_INDEX   = None  # None = process all

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

# Fields to embed from PLLM file → output key name
PLLM_FIELDS = [
    ("event_analysis",    "pllm_event_analyst"),
    ("metadata_analysis", "pllm_metadata_analyst"),
    ("neighbor_analysis", "pllm_neighbor_analyst"),
    ("final_answer",      "pllm_full"),
]
# ─────────────────────────────────────────────────────────────────────────────


def get_embedding(text: str, client: OpenAI) -> Optional[List[float]]:
    """Return embedding vector for text, or None on failure / empty input."""
    if not text or not isinstance(text, str) or text.strip() == "":
        return None
    try:
        response = client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=text,
            encoding_format="float"
        )
        return response.data[0].embedding
    except Exception as e:
        print(f"    ❌ Embedding error: {e}")
        return None


def process_record(
    pllm_rec: Dict[str, Any],
    openai_rec: Dict[str, Any],
    client: OpenAI,
    display_idx: int
) -> Dict[str, Any]:
    source_id   = pllm_rec.get("source_id", "unknown")
    source_name = pllm_rec.get("source_name", "unknown")
    obsid       = pllm_rec.get("obsid", "unknown")
    neighbors_count = pllm_rec.get("neighbors_count")

    print(f"\n[{display_idx}] {source_name}  (obsid: {obsid}, neighbors: {neighbors_count})")

    result: Dict[str, Any] = {
        "source_id":      source_id,
        "source_name":    source_name,
        "obsid":          obsid,
        "has_flare":      True,
        "neighbors_count": neighbors_count,
    }

    # ── PLLM agent fields ─────────────────────────────────────────────────────
    for src_field, out_key in PLLM_FIELDS:
        text = pllm_rec.get(src_field)
        result[out_key] = text

        if not text:
            print(f"  ⚠️  {out_key}: no text, skipping embedding")
            result[f"{out_key}_embeddings"] = None
            continue

        print(f"  🔄 {out_key}: {len(text)} chars → embedding...")
        emb = get_embedding(text, client)
        if emb:
            print(f"  ✅ {out_key}: {len(emb)}D")
        else:
            print(f"  ❌ {out_key}: embedding failed")
        result[f"{out_key}_embeddings"] = emb

    # ── OpenAI direct field ───────────────────────────────────────────────────
    openai_text = openai_rec.get("final_answer")
    result["open_ai_only"] = openai_text

    if not openai_text:
        print(f"  ⚠️  open_ai_only: no text, skipping embedding")
        result["open_ai_only_embeddings"] = None
    else:
        print(f"  🔄 open_ai_only: {len(openai_text)} chars → embedding...")
        emb = get_embedding(openai_text, client)
        if emb:
            print(f"  ✅ open_ai_only: {len(emb)}D")
        else:
            print(f"  ❌ open_ai_only: embedding failed")
        result["open_ai_only_embeddings"] = emb

    return result


def main():
    parser = argparse.ArgumentParser(description="Generate per-agent embeddings for flaring source results")
    parser.add_argument("--start", type=int, default=START_INDEX)
    parser.add_argument("--end",   type=int, default=END_INDEX)
    args = parser.parse_args()

    start = args.start
    end   = args.end

    script_dir = os.path.dirname(os.path.abspath(__file__))

    print("=" * 80)
    print("Flaring Sources Agent Embeddings Generator")
    print("=" * 80)
    print(f"PLLM file:   {PLLM_FILE}")
    print(f"OpenAI file: {OPENAI_FILE}")
    print(f"Output:      {OUTPUT_FILE}")
    print(f"Model:       {EMBEDDING_MODEL}")
    print(f"Range:       {start} → {'end' if end is None else end}")
    print("=" * 80)

    client = OpenAI(api_key=OPENAI_API_KEY)
    print("✅ OpenAI client initialized")

    # ── Load files ─────────────────────────────────────────────────────────────
    def load(filename):
        path = os.path.join(script_dir, filename)
        print(f"\nLoading {path} ...")
        with open(path) as f:
            data = json.load(f)
        print(f"  ✅ {len(data)} records")
        return data

    pllm_data   = load(PLLM_FILE)
    openai_data = load(OPENAI_FILE)

    # Build lookup: source_id → openai record
    openai_lookup: Dict[str, Dict] = {r["source_id"]: r for r in openai_data}

    # ── Intersection only ──────────────────────────────────────────────────────
    common_ids = {r["source_id"] for r in pllm_data} & set(openai_lookup.keys())
    pllm_data  = [r for r in pllm_data if r["source_id"] in common_ids]

    nc10   = sum(1 for r in pllm_data if r.get("neighbors_count") == 10)
    nc0    = sum(1 for r in pllm_data if (r.get("neighbors_count") or 0) == 0)
    nc_gt5 = sum(1 for r in pllm_data if (r.get("neighbors_count") or 0) > 5)

    print(f"\nIntersection: {len(pllm_data)} records present in both files")
    print(f"  neighbors_count == 10: {nc10}")
    print(f"  neighbors_count >  5:  {nc_gt5}")
    print(f"  neighbors_count == 0:  {nc0}  (excluded — no neighbor analysis)")

    # ── Keep only records that have neighbors ──────────────────────────────────
    pllm_data = [r for r in pllm_data if (r.get("neighbors_count") or 0) > 0]
    print(f"  After filtering to records with neighbors: {len(pllm_data)}")

    # ── Apply range ────────────────────────────────────────────────────────────
    total      = len(pllm_data)
    slice_data = pllm_data[start:end]
    print(f"Processing {len(slice_data)} of {total} records (range [{start}:{end}])")

    # ── Process ────────────────────────────────────────────────────────────────
    results = []
    stats = {"full": 0, "partial": 0, "none": 0}

    for i, pllm_rec in enumerate(slice_data):
        source_id  = pllm_rec.get("source_id")
        openai_rec = openai_lookup[source_id]  # guaranteed — intersection

        rec = process_record(pllm_rec, openai_rec, client, start + i + 1)
        results.append(rec)

        emb_keys = [
            "pllm_event_analyst_embeddings",
            "pllm_metadata_analyst_embeddings",
            "pllm_neighbor_analyst_embeddings",
            "pllm_full_embeddings",
            "open_ai_only_embeddings",
        ]
        n_ok = sum(1 for k in emb_keys if rec.get(k) is not None)
        if n_ok == 5:
            stats["full"] += 1
        elif n_ok > 0:
            stats["partial"] += 1
        else:
            stats["none"] += 1

    # ── Save ───────────────────────────────────────────────────────────────────
    out_path = os.path.join(script_dir, OUTPUT_FILE)
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\n✅ Saved {len(results)} records → {out_path}")

    # ── Summary ────────────────────────────────────────────────────────────────
    print("\n" + "=" * 80)
    print("Summary")
    print("=" * 80)
    print(f"  Total processed:         {len(results)}")
    print(f"  All 5 embeddings OK:     {stats['full']}")
    print(f"  Partial (some missing):  {stats['partial']}")
    print(f"  No embeddings:           {stats['none']}")
    print(f"  has_flare:               True (all records)")
    print("=" * 80)
    print("Done!")


if __name__ == "__main__":
    main()
