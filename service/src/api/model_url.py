"""Which model-server URL a request may use.

`model_api_url` lets a caller point the service at a model server of their
choosing. The service then POSTs the user's prompt and event list there, so
on a shared deployment it is a server-side request forgery primitive: any
caller can make the service send requests to hosts on the docker network or
the cloud metadata endpoint.

The webapp already drops the field unless ALLOW_CUSTOM_MODEL_URL=true. The
service enforces the same rule itself, so the guarantee does not depend on
every caller remembering to filter it.
"""

from __future__ import annotations

from typing import Optional

from src.core.settings import get_settings


def effective_model_url(requested: Optional[str], configured: Optional[str]) -> Optional[str]:
    """The URL to call: the request's when custom URLs are allowed, else the configured one."""
    if get_settings().allow_custom_model_url and isinstance(requested, str) and requested.strip():
        return requested.strip()
    return configured
