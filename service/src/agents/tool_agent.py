"""Multi-wavelength imaging agent (HiPS2FITS).

Hardcoded research agent that, given the source's RA/Dec, iteratively queries
the public CDS HiPS2FITS service for multi-wavelength sky cutouts and uses
GPT-5 to synthesise a classification narrative from morphology and
counterpart presence across surveys.

Design choices:

- One single tool is exposed to the LLM (`hips2fits_image`). The JSON schema
  is inlined here, not loaded from YAML. There is intentionally no generic
  registry / executor — see `axia/docs/02_multi_agent_workflow.md`.
- The HiPS2FITS endpoint is the public, anonymous CDS service. No auth
  needed. We send the image bytes back to the LLM as `image_url` content so
  the model can directly look at it (GPT-5 vision).
- Coordinates are extracted from the source object's catalogue metadata
  (`ra`/`dec` or `pos_ra_deg`/`pos_dec_deg`). If neither is present, the
  agent skips itself and returns an explanatory note.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import httpx
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# HiPS2FITS public endpoint
# ---------------------------------------------------------------------------

HIPS2FITS_URL = "http://alasky.cds.unistra.fr/hips-image-services/hips2fits"
HIPS2FITS_TIMEOUT_S = 60.0
HIPS2FITS_USER_AGENT = "axia/1.0 (HiPS2FITS research agent)"

# The full list of supported survey IDs lives at
# https://aladin.cds.unistra.fr/hips/list; the ones below are the verified
# subset used in the paper.
SURVEY_REFERENCE = """\
Verified HiPS survey IDs for X-ray multi-wavelength analysis:

  Optical
    CDS/P/DSS2/color                          baseline optical (DEFAULT FIRST LOOK)
    CDS/P/PanSTARRS/DR1/color-z-zg-g          deep optical where covered
    CDS/P/SDSS9/color                         5-band optical where covered
  UV
    CDS/P/GALEXGR6/AIS/color                  hot components / star formation
  Near & mid IR
    CDS/P/2MASS/color                         stellar populations, dust penetration
    CDS/P/allWISE/color                       warm dust / AGN selection
    CDS/P/SPITZER/color                       higher-resolution mid-IR where available
  Radio
    CDS/P/NVSS                                1.4 GHz continuum, jets/lobes
  High-energy
    CDS/P/Fermi/color                         gamma-ray context
  Far-IR
    ESAVO/P/HERSCHEL/PACS160                  cold dust, star-forming regions
"""

SYSTEM_PROMPT_TEMPLATE = """\
You are an astrophysicist research assistant that completes the multi-agent
X-ray source analysis by querying multi-wavelength sky images and reasoning
about the cross-wavelength evidence.

# Upstream context you receive (already attached to the user message):
  - Event Analyzer    -- temporal behaviour from X-ray photon events
  - Metadata Analyzer -- catalogue metadata + spectrum snapshot
  - Neighbour Analyzer -- closest sources in the embedding space
  - Critic            -- gaps, caveats, suggested follow-ups

# Your job
Close the gaps the Critic raised by iteratively fetching multi-wavelength
images via the `hips2fits_image` tool. Strategically pick surveys, cross-
check morphology / counterparts / environment, and converge on a defensible
classification.

# Source coordinates
The source's coordinates have ALREADY been extracted from the catalogue and
are listed in the user message. Always pass those exact values to the tool;
never guess and never use placeholder defaults like 0, 0.

# Tool
hips2fits_image(hips, ra, dec, fov, width=512, height=512, projection='TAN',
                coordsys='icrs', format='png')

  Returns one image at the given coordinates from the named survey. Always
  set width=height=512, format='png', coordsys='icrs', projection='TAN' for
  fov < 10 deg unless you can justify otherwise.

{survey_reference}

# Field of view rules of thumb
  0.02 deg  (~3')   -- compact point source / counterpart check
  0.1  deg  (~6')   -- DEFAULT for typical X-ray sources
  0.2-0.5  deg      -- extended sources, environment
  1.0+ deg          -- cluster scale, large structures

# Operating loop (think like a small observing programme)
  1. Start with optical DSS2 at fov=0.02 to centre on the object, then
     fov=0.1 to assess the immediate environment.
  2. Form a concrete hypothesis (obscured AGN? stellar coronal source?
     galaxy? cluster?).
  3. Test it with the next most discriminative wavelength. Change ONE
     variable per iteration (survey OR fov).
  4. Stop early when the answer is clear. Otherwise keep going up to
     {max_iterations} total queries.

# Decision heuristics (guide, not a script)
  - No optical counterpart      -> try 2MASS / WISE for obscuration
  - Compact blue optical        -> check GALEX for hot component
  - Extended host galaxy        -> widen fov, then WISE for AGN/dust;
                                   NVSS if radio-loud features suspected
  - Faint optical, bright IR    -> obscured AGN candidate; confirm with
                                   deeper optical (PanSTARRS / SDSS)
  - Crowded field               -> widen fov to 0.5-1.0 deg

# Output requirements (be generous, not brief)
Return a single markdown response with:
  1. Step-by-step activity log (for each query: survey, fov, what you looked
     for, what you observed, how it changed your hypothesis).
  2. Multi-wavelength findings (morphology, counterpart presence,
     alignment, dust/AGN/star-formation signs, radio features, environment).
  3. Classification & justification (most likely source type with the
     specific evidence chain; confidence: High / Medium / Low).
  4. How you addressed each gap the Critic raised.
  5. What additional data would decisively improve confidence, if any.
"""


# ---------------------------------------------------------------------------
# Tool spec (the only tool exposed to the LLM)
# ---------------------------------------------------------------------------

HIPS2FITS_TOOL_SPEC: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "hips2fits_image",
        "description": (
            "Fetch a sky-image cutout from the public CDS HiPS2FITS service. "
            "Returns a PNG image which is shown back to you so you can look "
            "at it directly. Use this iteratively to assess morphology, "
            "counterparts, and environment across multiple wavelengths."
        ),
        "parameters": {
            "type": "object",
            "required": ["hips", "ra", "dec", "fov"],
            "properties": {
                "hips": {
                    "type": "string",
                    "description": (
                        "HiPS survey identifier (e.g. 'CDS/P/DSS2/color'). "
                        "Pick from the verified list in the system prompt."
                    ),
                },
                "ra": {
                    "type": "number",
                    "description": "Right Ascension in decimal degrees (ICRS, J2000).",
                    "minimum": 0,
                    "maximum": 360,
                },
                "dec": {
                    "type": "number",
                    "description": "Declination in decimal degrees (ICRS, J2000).",
                    "minimum": -90,
                    "maximum": 90,
                },
                "fov": {
                    "type": "number",
                    "description": (
                        "Field of view in decimal degrees. Typical: 0.02 (zoom in), "
                        "0.1 (default), 0.5-1.0 (extended/environment)."
                    ),
                    "minimum": 0.001,
                    "maximum": 10.0,
                },
                "width": {"type": "integer", "default": 512, "minimum": 64, "maximum": 2048},
                "height": {"type": "integer", "default": 512, "minimum": 64, "maximum": 2048},
                "projection": {
                    "type": "string",
                    "enum": ["TAN", "SIN", "AIT", "MOL", "STG", "ZEA", "CAR"],
                    "default": "TAN",
                },
                "coordsys": {
                    "type": "string",
                    "enum": ["icrs", "galactic", "ecliptic"],
                    "default": "icrs",
                },
                "format": {
                    "type": "string",
                    "enum": ["png", "jpg", "fits"],
                    "default": "png",
                },
            },
        },
    },
}


# ---------------------------------------------------------------------------
# HiPS2FITS HTTP call
# ---------------------------------------------------------------------------

async def _call_hips2fits(
    client: httpx.AsyncClient, params: Dict[str, Any]
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """One GET request to HiPS2FITS.

    Returns (result, error). The result is `{type, format, data_url, size_bytes}`
    on success; `data_url` is a `data:image/png;base64,...` ready to be sent
    back to the LLM as an `image_url` content part.
    """
    # Sane defaults so the LLM doesn't have to specify them every time.
    request_params: Dict[str, Any] = {
        "width": 512,
        "height": 512,
        "projection": "TAN",
        "coordsys": "icrs",
        "format": "png",
        **{k: v for k, v in params.items() if v is not None},
    }

    try:
        response = await client.get(
            HIPS2FITS_URL,
            params=request_params,
            headers={"User-Agent": HIPS2FITS_USER_AGENT},
            timeout=HIPS2FITS_TIMEOUT_S,
        )
    except httpx.TimeoutException:
        return None, f"HiPS2FITS request timed out after {HIPS2FITS_TIMEOUT_S}s"
    except httpx.RequestError as e:
        return None, f"HiPS2FITS request error: {e}"

    if response.status_code >= 400:
        return None, f"HiPS2FITS HTTP {response.status_code}: {response.text[:200]}"

    content_type = response.headers.get("content-type", "")
    if "image/" not in content_type:
        return None, f"Unexpected content-type from HiPS2FITS: {content_type!r}"

    b64 = base64.b64encode(response.content).decode("ascii")
    return (
        {
            "type": "image",
            "format": content_type.split("/")[-1],
            "data": f"data:{content_type};base64,{b64}",
            "size_bytes": len(response.content),
        },
        None,
    )


# ---------------------------------------------------------------------------
# Coordinate extraction
# ---------------------------------------------------------------------------

def _extract_coords(data_obj: Optional[Dict[str, Any]]) -> Tuple[Optional[float], Optional[float]]:
    """Resolve RA/Dec for the source from the merged corpus document.

    The corpus collection carries `ra`/`dec` on every source. We also accept
    the legacy `pos_ra_deg`/`pos_dec_deg` aliases for back-compat with any
    user-uploaded sources that follow an older schema. If neither is present
    the agent skips itself and returns a graceful message — there is no
    secondary Mongo lookup any more (it used to fall back to a separate
    `raw_events` collection, which has been folded into the corpus).
    """
    if not data_obj:
        return None, None
    ra = data_obj.get("ra") if data_obj.get("ra") is not None else data_obj.get("pos_ra_deg")
    dec = data_obj.get("dec") if data_obj.get("dec") is not None else data_obj.get("pos_dec_deg")
    if ra is None or dec is None:
        return None, None
    try:
        return float(ra), float(dec)
    except (TypeError, ValueError):
        return None, None


# ---------------------------------------------------------------------------
# The agent
# ---------------------------------------------------------------------------

class ToolAgent:
    """Multi-wavelength imaging research agent (HiPS2FITS only).

    Implements the same external contract as the previous generic Tool Agent
    so the rest of the workflow does not need to know about the change:

        result = await agent.analyze(
            user_question=...,
            conversation_history=[...],
            critic_review=...,
            data_obj=...,
        )
        # -> {
        #      "tool_enhanced_analysis": str,
        #      "tool_executions": list[dict],
        #      "artifacts": list[dict],
        #      "iterations": int,
        #      "total_time_ms": int,
        #    }
    """

    DEFAULT_MODEL = "gpt-4o"
    DEFAULT_MAX_ITERATIONS = 10
    DEFAULT_TEMPERATURE = 0.3

    def __init__(
        self,
        openai_client: AsyncOpenAI,
        model: str = DEFAULT_MODEL,
        max_iterations: int = DEFAULT_MAX_ITERATIONS,
        temperature: float = DEFAULT_TEMPERATURE,
    ):
        self.openai_client = openai_client
        self.model = model
        self.max_iterations = max_iterations
        self.temperature = temperature
        logger.info(
            "ToolAgent (hips2fits) initialised: model=%s, max_iterations=%d",
            self.model,
            self.max_iterations,
        )

    # ----------------------------------------------------------- helpers

    def _system_prompt(self) -> str:
        return SYSTEM_PROMPT_TEMPLATE.format(
            survey_reference=SURVEY_REFERENCE.rstrip(),
            max_iterations=self.max_iterations,
        )

    @staticmethod
    def _user_prompt(user_question: str, critic_review: str, ra: float, dec: float) -> str:
        return (
            "# Source coordinates (use these exact values for every tool call)\n"
            f"  RA  = {ra:.6f} deg (ICRS)\n"
            f"  Dec = {dec:.6f} deg (ICRS)\n\n"
            "# User's question\n"
            f"{user_question}\n\n"
            "# Critic's review of prior analyses\n"
            f"{critic_review}\n\n"
            "# Your task\n"
            "Address the gaps identified above using multi-wavelength imaging "
            "queries via `hips2fits_image`. Follow the strategy and output "
            "format described in the system prompt."
        )

    # ----------------------------------------------------------- main entry

    async def analyze(
        self,
        user_question: str,
        conversation_history: List[Dict[str, str]],
        critic_review: str,
        data_obj: Optional[Dict[str, Any]] = None,
        artifact_callback: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """Run the imaging research loop.

        ``artifact_callback`` is an optional ``async def cb(artifact)``
        invoked the moment each image is fetched. The workflow uses it to
        stream artifact events to the SSE client (so each image appears in
        the UI as it lands, instead of only at the end).
        """
        start = datetime.utcnow()
        ra, dec = _extract_coords(data_obj)
        if ra is None or dec is None:
            note = (
                "No usable RA/Dec available for this source "
                f"(checked `ra`, `dec`, `pos_ra_deg`, `pos_dec_deg`). "
                "Skipping multi-wavelength imaging."
            )
            logger.info("ToolAgent skipped: %s", note)
            return {
                "tool_enhanced_analysis": note,
                "tool_executions": [],
                "artifacts": [],
                "iterations": 0,
                "total_time_ms": 0,
            }

        messages: List[Dict[str, Any]] = [{"role": "system", "content": self._system_prompt()}]
        if conversation_history:
            messages.extend(conversation_history)
        messages.append({"role": "user", "content": self._user_prompt(user_question, critic_review, ra, dec)})

        tool_executions: List[Dict[str, Any]] = []
        artifacts: List[Dict[str, Any]] = []
        iteration = 0

        async with httpx.AsyncClient() as http:
            while iteration < self.max_iterations:
                iteration += 1
                logger.info("ToolAgent iteration %d/%d", iteration, self.max_iterations)

                try:
                    completion = await self.openai_client.chat.completions.create(
                        model=self.model,
                        messages=messages,
                        tools=[HIPS2FITS_TOOL_SPEC],
                        temperature=self.temperature,
                    )
                except Exception as e:  # noqa: BLE001
                    logger.error("OpenAI call failed (iter %d): %s", iteration, e, exc_info=True)
                    break

                assistant = completion.choices[0].message

                if not assistant.tool_calls:
                    # No more tool calls — final synthesis.
                    elapsed_ms = int((datetime.utcnow() - start).total_seconds() * 1000)
                    logger.info(
                        "ToolAgent done: %d iterations, %d tool calls, %d artifacts, %d ms",
                        iteration, len(tool_executions), len(artifacts), elapsed_ms,
                    )
                    return {
                        "tool_enhanced_analysis": assistant.content or "Multi-wavelength analysis complete.",
                        "tool_executions": tool_executions,
                        "artifacts": artifacts,
                        "iterations": iteration,
                        "total_time_ms": elapsed_ms,
                    }

                # Record the assistant turn (must include tool_calls so the
                # subsequent tool responses are valid).
                messages.append(
                    {
                        "role": "assistant",
                        "content": assistant.content,
                        "tool_calls": [
                            {
                                "id": tc.id,
                                "type": tc.type,
                                "function": {
                                    "name": tc.function.name,
                                    "arguments": tc.function.arguments,
                                },
                            }
                            for tc in assistant.tool_calls
                        ],
                    }
                )

                # OpenAI's contract: an assistant message with tool_calls MUST be
                # followed by exactly one tool message per tool_call_id, with no
                # other messages in between. So execute every call first, append
                # the matching tool messages in order, and only then attach the
                # follow-up user messages that carry the images for the model to
                # look at.
                pending_images: List[Dict[str, Any]] = []

                for tc in assistant.tool_calls:
                    try:
                        args = json.loads(tc.function.arguments or "{}")
                    except json.JSONDecodeError as e:
                        logger.warning("Malformed tool arguments: %s", e)
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tc.id,
                                "content": f"Error: malformed JSON arguments ({e})",
                            }
                        )
                        continue

                    if tc.function.name != "hips2fits_image":
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tc.id,
                                "content": f"Error: unknown tool '{tc.function.name}'",
                            }
                        )
                        continue

                    # Force the model's coordinates back to the catalogue
                    # values — protects against hallucinated RA/Dec.
                    args["ra"] = ra
                    args["dec"] = dec

                    call_started = datetime.utcnow()
                    result, error = await _call_hips2fits(http, args)
                    call_elapsed_ms = int((datetime.utcnow() - call_started).total_seconds() * 1000)

                    # Keep the image data in `result.data` so the UI's
                    # per-tool-call card (ToolOutputRenderer) can render it
                    # inline. `data_kb` is a convenience for badges.
                    tool_executions.append(
                        {
                            "tool_name": "hips2fits_image",
                            "arguments": args,
                            "result": (
                                {**result, "data_kb": result["size_bytes"] // 1024}
                                if result
                                else None
                            ),
                            "error": error,
                            "status": "success" if result else "error",
                            "execution_time_ms": call_elapsed_ms,
                            "iteration": iteration,
                        }
                    )

                    if result:
                        survey = args.get("hips", "unknown")
                        artifact = {
                            "type": "image",
                            "name": f"{survey} (fov={args.get('fov')}°)",
                            "description": (
                                f"Multi-wavelength cutout: {survey} at "
                                f"RA={args.get('ra'):.4f}°, Dec={args.get('dec'):.4f}°, "
                                f"fov={args.get('fov')}°."
                            ),
                            "agent": "ToolAgent",
                            # Match the shape MetadataAnalyst uses so the
                            # webapp's `<ToolOutputRenderer result={{ data, format, type }} />`
                            # finds the image in `.data`.
                            "data": result["data"],
                            "url": result["data"],
                            "format": result.get("format", "png"),
                            "metadata": {
                                "tool": "hips2fits_image",
                                "survey": survey,
                                "fov": args.get("fov"),
                                "ra": args.get("ra"),
                                "dec": args.get("dec"),
                                "iteration": iteration,
                            },
                        }
                        artifacts.append(artifact)
                        if artifact_callback is not None:
                            try:
                                await artifact_callback(artifact)
                            except Exception as e:  # noqa: BLE001
                                logger.warning("artifact_callback raised: %s", e)
                        # Tool messages must be plain strings, so we send a
                        # short summary here and queue the image to follow.
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tc.id,
                                "content": (
                                    f"Retrieved {result['format']} image "
                                    f"({result['size_bytes']} bytes) from "
                                    f"{args.get('hips')} at fov={args.get('fov')} deg."
                                ),
                            }
                        )
                        pending_images.append(
                            {
                                "survey": args.get("hips"),
                                "fov": args.get("fov"),
                                "data": result["data"],
                            }
                        )
                    else:
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tc.id,
                                "content": f"Error fetching image: {error}",
                            }
                        )

                # Now (after every tool message is in place) feed the images
                # to the model so it can actually look at them.
                if pending_images:
                    logger.info(
                        "ToolAgent iter %d: sending %d image(s) to %s for vision analysis (%s)",
                        iteration,
                        len(pending_images),
                        self.model,
                        ", ".join(
                            f"{img['survey']}@fov={img['fov']}"
                            for img in pending_images
                        ),
                    )
                for img in pending_images:
                    messages.append(
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "text",
                                    "text": f"Image from {img['survey']} (fov={img['fov']} deg):",
                                },
                                {
                                    "type": "image_url",
                                    "image_url": {"url": img["data"]},
                                },
                            ],
                        }
                    )

        # Reached max iterations.
        elapsed_ms = int((datetime.utcnow() - start).total_seconds() * 1000)
        logger.warning("ToolAgent hit max_iterations=%d", self.max_iterations)
        return {
            "tool_enhanced_analysis": (
                "Multi-wavelength analysis completed with the data gathered so far "
                f"(reached the {self.max_iterations}-query limit)."
            ),
            "tool_executions": tool_executions,
            "artifacts": artifacts,
            "iterations": iteration,
            "total_time_ms": elapsed_ms,
        }
