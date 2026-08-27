"""FastAPI entry point. Run with:
    uvicorn app.main:app --reload --port 8000
from inside backend/, with a venv active and .env filled in.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.config import settings
from app.routers import answer_keys, auth, dashboard, results, sessions, settings as settings_router

app = FastAPI(title="Automated Grading System API")

# Signed-cookie session, the direct equivalent of Flask's session[...] --
# see app/security.py for why this project uses cookie sessions instead
# of JWTs.
app.add_middleware(SessionMiddleware, secret_key=settings.secret_key, same_site="lax")

# Only needed if the Vue dev server talks to this API cross-origin
# instead of through the Vite proxy (vue-app/vite.config.js). Harmless
# either way, and needed for a future non-proxied deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(answer_keys.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(results.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(settings_router.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok"}
