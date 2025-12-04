# security_cookie.py  (or paste into your main file)
import os
import time
import hmac
import hashlib
import base64

SECRET_KEY = os.getenv("APP_SECRET", "dev-secret-change-me")
COOKIE_NAME = "syncify_unlocked"
COOKIE_MAX_AGE = 30  *60 * 60 * 24  # 1 day

def _sign(payload: str) -> str:
    """Return base64(payload|sig)."""
    sig = hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).digest()
    token = payload + "|" + base64.urlsafe_b64encode(sig).decode()
    return base64.urlsafe_b64encode(token.encode()).decode()

def _unsign(token_b64: str, max_age: int = COOKIE_MAX_AGE) -> bool:
    """Verify token; return True if valid and not expired."""
    try:
        token = base64.urlsafe_b64decode(token_b64.encode()).decode()
        payload, sig_b64 = token.rsplit("|", 1)
        expected_sig = base64.urlsafe_b64encode(
            hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).digest()
        ).decode()
        if not hmac.compare_digest(sig_b64, expected_sig):
            return False
        # payload format: "ts=<int>"
        if not payload.startswith("ts="):
            return False
        ts = int(payload.split("=", 1)[1])
        if time.time() - ts > max_age:
            return False
        return True
    except Exception:
        return False
