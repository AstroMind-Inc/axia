"""Central registry of the OpenAI models Axia talks to.

Model identifiers used to be hardcoded in every call site (`gpt-5-mini` in
five modules, `gpt-4o` in the tool agent, `gpt-4o-mini` in the client,
`o3-mini` in the validator), and model-family detection was done with
chained equality checks like::

    if (model == "gpt-5") or (model == "gpt-5-mini") or (model == "gpt-5-nano"):

which silently stopped matching the moment a new model shipped. Everything
now goes through this module.

Reasoning-model parameter rules (GPT-5.x), which the callers must respect or
the API returns 400:

* ``temperature`` only accepts its default of 1. Passing anything else is
  rejected, so we omit the parameter entirely rather than sending 1.0 —
  omitting is equivalent and stays correct if the default ever moves.
* ``top_p`` is rejected on the same grounds; we never send it.
* Function tools and reasoning cannot be combined on Chat Completions.
  A request carrying ``tools`` must either set ``reasoning_effort="none"``
  or move to the Responses API. ``tool_kwargs()`` does the former.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

# The flagship GPT-5.6 variant. Used whenever a caller does not specify one.
DEFAULT_MODEL = "gpt-5.6-sol"

# Models offered in the UI, in the order they should be listed.
SUPPORTED_MODELS: Dict[str, Dict[str, str]] = {
    "gpt-5.6-sol": {
        "label": "gpt-5.6-sol",
        "hint": "Flagship: deepest reasoning and best science; slower responses",
    },
    "gpt-5.6-terra": {
        "label": "gpt-5.6-terra",
        "hint": "Balanced quality, cost and speed; good everyday default",
    },
    "gpt-5.6-luna": {
        "label": "gpt-5.6-luna",
        "hint": "Fastest and cheapest; best for short or high-volume questions",
    },
}

# Families whose sampling parameters are constrained. Matched by prefix so
# that future point releases (gpt-5.7, ...) are picked up automatically.
_REASONING_PREFIXES = ("gpt-5", "o1", "o3", "o4")

# Valid values for reasoning_effort on Chat Completions.
REASONING_EFFORTS = ("none", "minimal", "low", "medium", "high", "xhigh", "max")

DEFAULT_REASONING_EFFORT = "medium"


def is_reasoning_model(model: Optional[str]) -> bool:
    """True when `model` constrains temperature/top_p and supports reasoning."""
    if not model:
        return False
    return model.startswith(_REASONING_PREFIXES)


def resolve(model: Optional[str]) -> str:
    """Return the model to use, honouring OPENAI_DEFAULT_MODEL.

    Precedence: the model named by the request, then the deployment's
    OPENAI_DEFAULT_MODEL, then DEFAULT_MODEL. The settings import is done
    lazily because src.core.settings imports DEFAULT_MODEL from this module
    for its field default, and a module-level import would be circular.
    """
    if model:
        return model
    try:
        from src.core.settings import get_settings

        configured = get_settings().openai_default_model
    except Exception:  # settings unavailable (e.g. during early import)
        configured = None
    return configured or DEFAULT_MODEL


def sampling_kwargs(
    model: str,
    temperature: Optional[float] = None,
    *,
    reasoning_effort: Optional[str] = None,
) -> Dict[str, Any]:
    """Build the sampling parameters that are legal for `model`.

    For reasoning models this omits `temperature` and optionally sets
    `reasoning_effort`. For everything else it passes `temperature` through.
    """
    if is_reasoning_model(model):
        kwargs: Dict[str, Any] = {}
        effort = reasoning_effort or DEFAULT_REASONING_EFFORT
        if effort not in REASONING_EFFORTS:
            raise ValueError(
                f"reasoning_effort must be one of {REASONING_EFFORTS}, got {effort!r}"
            )
        kwargs["reasoning_effort"] = effort
        return kwargs

    return {} if temperature is None else {"temperature": temperature}


def tool_kwargs(model: str, temperature: Optional[float] = None) -> Dict[str, Any]:
    """Sampling parameters for a Chat Completions request that carries `tools`.

    Reasoning and function tools are mutually exclusive on Chat Completions,
    so reasoning is switched off rather than left at its default — otherwise
    the request is rejected.
    """
    if is_reasoning_model(model):
        return {"reasoning_effort": "none"}
    return {} if temperature is None else {"temperature": temperature}
