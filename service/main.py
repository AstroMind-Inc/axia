"""Axia service entry point — FastAPI app mounting the multi-agent chat and
object-details routers.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.api.chat import router as chat_router
from src.api.object_details import router as object_details_router
from src.api.validate import router as validate_router
from src.core.logger import setup_logger
from src.core.settings import get_settings

app = FastAPI(
    title="Axia",
    description="Multi-agent X-ray source decoder for the Chandra Source Catalog.",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

settings = get_settings()
logger = setup_logger()

# The service has no authentication, so it must not be callable from web
# pages. A wildcard origin with credentials made any website able to drive a
# developer's local service (spending their OpenAI key). In production only
# the webapp's server calls it, which needs no CORS at all.
_cors_origins = [o.strip() for o in settings.cors_allow_origins.split(",") if o.strip()]
if _cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )


@app.on_event("startup")
async def startup_event() -> None:
    logger.info("Starting Axia service ...")
    logger.info(
        "Configuration: MODEL_SERVER_URL=%s, PROJECTOR_URL=%s, OPENAI_API_KEY=%s, MONGODB_DB=%s",
        "set" if settings.model_server_configured else "unset (Event Analyst disabled)",
        "set" if settings.projector_configured else "unset (falls back to MODEL_SERVER_URL)",
        "set" if settings.openai_api_key else "unset (GPT-5 agents will fail)",
        settings.mongodb_db,
    )


@app.on_event("shutdown")
async def shutdown_event() -> None:
    logger.info("Shutting down Axia service ...")


@app.get("/health")
async def health():
    """Liveness probe + configuration summary."""
    return {
        "status": "ok",
        "model_server_configured": settings.model_server_configured,
        "projector_configured": settings.projector_configured,
        "embedding_url": settings.embedding_url or "(none)",
        "openai_configured": bool(settings.openai_api_key),
        "mongodb_db": settings.mongodb_db,
    }


app.include_router(chat_router, prefix="/v1", tags=["chat"])
app.include_router(object_details_router, prefix="/v1", tags=["object-details"])
app.include_router(validate_router, prefix="/v1", tags=["validate"])


@app.exception_handler(HTTPException)
async def custom_http_exception_handler(request, exc):  # noqa: D401
    # Must return a Response: returning a dict made every HTTPException a 500.
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "message": str(exc.detail),
            "code": exc.status_code,
            "details": getattr(exc, "details", None),
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=settings.service_host,
        port=settings.service_port,
        reload=settings.service_debug,
        log_level=settings.service_log_level,
    )
