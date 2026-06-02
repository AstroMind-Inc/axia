"""Generate Q&A pairs from CSC catalog metadata, mirroring the training corpus
construction used in the paper.

This script is for users who want to RE-TRAIN the model from scratch on their
own corpus. The output JSON is consumed by `model/training/train.py`.

It is intentionally minimal: it produces the same 4 question templates per
source that we used in the paper (spectral model, source type, variability,
physical properties). A more elaborate version with chained Q&A sequences
lives in `side_studies/bulk_eval/` (the `create_comparison*.py` scripts).

Usage:
    python build_qna_dataset.py \
        --sources sources_with_embeddings.json \
        --output qna_sequences.json
"""

import argparse
import json
import math
from pathlib import Path


def fmt(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "(not available)"
    if isinstance(v, float):
        return f"{v:.4g}"
    return str(v)


def qa_pairs_for(s: dict) -> list[dict]:
    """Return a list of {question, answer} pairs derived from catalog metadata."""

    pairs: list[dict] = []

    # Spectral model fits
    models = []
    for name, key_stat, key_param in [
        ("absorbed power-law", "powlaw_stat", "powlaw_gamma"),
        ("blackbody", "bb_stat", "bb_kt"),
        ("bremsstrahlung", "brems_stat", "brems_kt"),
        ("APEC plasma", "apec_stat", "apec_kt"),
    ]:
        if s.get(key_stat) is not None and not (isinstance(s[key_stat], float) and math.isnan(s[key_stat])):
            models.append((name, s[key_stat], s.get(key_param)))
    models.sort(key=lambda x: x[1])
    if models:
        best = models[0]
        pairs.append(
            {
                "question": "What spectral models fit this source? <xray>",
                "answer": (
                    f"The best statistical fit is the {best[0]} model with reduced-statistic "
                    f"{fmt(best[1])} and characteristic parameter {fmt(best[2])}."
                ),
            }
        )

    # Source type
    if s.get("source_type") and s["source_type"] != "X":
        pairs.append(
            {
                "question": "What is the likely source type? <xray>",
                "answer": (
                    f"This source is classified as {s['source_type']} "
                    f"(category: {s.get('source_type_category', 'Other')})."
                ),
            }
        )

    # Variability
    var = s.get("var_index_b")
    if var is not None:
        if var <= 2:
            verdict = "No significant variability"
        elif var <= 5:
            verdict = "Moderate variability"
        else:
            verdict = "Strong variability"
        pairs.append(
            {
                "question": "Is this source variable? <xray>",
                "answer": f"{verdict} (var_index_b={fmt(var)}).",
            }
        )

    # Hardness summary
    hs = s.get("hard_hs")
    if hs is not None:
        if hs > 0.5:
            shape = "hard"
        elif hs < -0.5:
            shape = "soft"
        else:
            shape = "intermediate"
        pairs.append(
            {
                "question": "Describe the spectral hardness of this source. <xray>",
                "answer": (
                    f"The HS hardness ratio is {fmt(hs)}, indicating a {shape} spectrum "
                    f"(HM={fmt(s.get('hard_hm'))}, MS={fmt(s.get('hard_ms'))})."
                ),
            }
        )

    return pairs


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--sources", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    args = p.parse_args()

    sources = json.loads(args.sources.read_text())
    out = []
    for s in sources:
        qna = qa_pairs_for(s)
        if not qna:
            continue
        out.append(
            {
                "obsid": s.get("obsid"),
                "source_name": s.get("source_name"),
                "source_type": s.get("source_type"),
                "source_type_category": s.get("source_type_category"),
                "event_list": s.get("event_list"),
                "qna": qna,
            }
        )

    args.output.write_text(json.dumps(out, indent=2, default=str))
    print(f"wrote {len(out)} source-QnA bundles ({sum(len(o['qna']) for o in out)} total pairs) to {args.output}")


if __name__ == "__main__":
    main()
