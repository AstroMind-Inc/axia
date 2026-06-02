"""Compute pca_64d + umap_2d for each source by calling the model server's
`/project` endpoint.

The model server must already be reachable at MODEL_SERVER_URL (see
model/server/README.md for deployment instructions).

Usage:
    python compute_embeddings.py --input sources.json --output sources_with_embeddings.json

Each input source must contain `obsid`, `source_name`, and `event_list`.
"""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

import aiohttp


async def project(session: aiohttp.ClientSession, url: str, event_list: list) -> dict:
    async with session.post(
        f"{url.rstrip('/')}/project",
        json={"event_list": event_list, "is_pruned": False},
        timeout=aiohttp.ClientTimeout(total=600),
    ) as resp:
        resp.raise_for_status()
        return await resp.json()


async def main_async(args: argparse.Namespace) -> int:
    url = args.model_server_url or os.environ.get("MODEL_SERVER_URL")
    if not url:
        sys.exit("MODEL_SERVER_URL is not set and --model-server-url not provided.")

    sources = json.loads(Path(args.input).read_text())
    print(f"loaded {len(sources)} sources from {args.input}")

    out: list[dict] = []
    failed: list[dict] = []
    async with aiohttp.ClientSession() as session:
        for i, s in enumerate(sources, 1):
            try:
                resp = await project(session, url, s["event_list"])
                if resp.get("errors"):
                    failed.append({"obsid": s.get("obsid"), "source_name": s.get("source_name"), "error": resp["errors"]})
                    continue
                s["pca_64d"] = resp.get("pca_64d")
                s["umap_2d"] = resp.get("umap_2d")
                # Replace event_list with pruned version, keep original under original_event_list
                if resp.get("pruned_event_list"):
                    s["original_event_list"] = s["event_list"]
                    s["event_list"] = resp["pruned_event_list"]
                out.append(s)
                print(f"  [{i}/{len(sources)}] {s.get('source_name', '?')}  pca={len(resp.get('pca_64d') or [])}d  umap={len(resp.get('umap_2d') or [])}d")
            except Exception as e:  # noqa: BLE001
                failed.append({"obsid": s.get("obsid"), "source_name": s.get("source_name"), "error": str(e)})

    Path(args.output).write_text(json.dumps(out, indent=2, default=str))
    print(f"wrote {len(out)} sources with embeddings to {args.output}")
    if failed:
        fail_path = Path(args.output).with_suffix(".failed.json")
        fail_path.write_text(json.dumps(failed, indent=2))
        print(f"  {len(failed)} sources failed; see {fail_path}")
    return 0


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True, help="Input JSON with event_list-bearing sources")
    p.add_argument("--output", required=True, help="Output JSON with pca_64d + umap_2d added")
    p.add_argument("--model-server-url", default=None, help="Override MODEL_SERVER_URL")
    args = p.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    raise SystemExit(main())
