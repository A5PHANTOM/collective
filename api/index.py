import os

# Vercel functions are request-scoped; the durable queue worker must run elsewhere.
os.environ.setdefault("EMBEDDED_WORKER", "false")

from backend.app import app

__all__ = ["app"]
