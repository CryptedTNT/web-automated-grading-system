"""FastAPI entry point. Run with:
    uvicorn app.main:app --reload --port 8000
from inside backend/, with a venv active and .env filled in.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import answer_keys, auth, dashboard, results, rosters, sessions, settings as settings_router
from app.session_middleware import RememberAwareSessionMiddleware

# Swagger/ReDoc/openapi.json are public by default -- viewing them needs
# no session cookie, only calling the endpoints they describe does. That's
# not a data leak, but it does hand anyone a full map of the API surface
# for free. SESSION_COOKIE_SECURE is already the flag that distinguishes
# a real deployment from local dev (see config.py) -- reuse it here so a
# real deployment doesn't publish its own API map, while local dev keeps
# the docs.
_docs_enabled = not settings.session_cookie_secure
app = FastAPI(
    title="Automated Grading System API",
    docs_url="/docs" if _docs_enabled else None,
    redoc_url="/redoc" if _docs_enabled else None,
    openapi_url="/openapi.json" if _docs_enabled else None,
)

# Signed-cookie session, the direct equivalent of Flask's session[...] --
# see app/security.py for why this project uses cookie sessions instead
# of JWTs. https_only follows SESSION_COOKIE_SECURE (see config.py) --
# must be true in production, since a session cookie without it can be
# read over an unencrypted connection (e.g. on public wifi). The 14-day
# max_age only actually reaches the browser when the login set
# remember_me (see RememberAwareSessionMiddleware) -- otherwise the
# cookie carries no Max-Age at all, so it's cleared when the browser
# closes, same as any other "until you quit" cookie.
app.add_middleware(
    RememberAwareSessionMiddleware,
    secret_key=settings.secret_key,
    same_site="lax",
    https_only=settings.session_cookie_secure,
)

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
app.include_router(rosters.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(settings_router.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok"}
