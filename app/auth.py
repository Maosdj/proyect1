"""Autenticacion: hash de contrasenas, sesiones y control de roles."""

import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from . import db

ITERATIONS = 120000
SESSION_DAYS = 14

ROLES = ("admin", "cajero", "cliente")
STAFF = ("admin", "cajero")


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def hash_password(password):
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS)
    return "pbkdf2$%d$%s$%s" % (
        ITERATIONS,
        base64.b64encode(salt).decode(),
        base64.b64encode(dk).decode(),
    )


def verify_password(password, stored):
    try:
        algo, iters, salt_b64, hash_b64 = stored.split("$")
        if algo != "pbkdf2":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(hash_b64)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iters))
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False


def create_session(user_id):
    token = secrets.token_urlsafe(32)
    created = datetime.now()
    expires = created + timedelta(days=SESSION_DAYS)
    db.execute(
        "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        (token, user_id, created.strftime("%Y-%m-%d %H:%M:%S"),
         expires.strftime("%Y-%m-%d %H:%M:%S")),
    )
    db.execute("DELETE FROM sessions WHERE expires_at < ?", (db.now(),))
    return token


def destroy_session(token):
    db.execute("DELETE FROM sessions WHERE token = ?", (token,))


def user_from_token(token):
    if not token:
        return None
    row = db.one(
        """SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token = ? AND s.expires_at > ? AND u.active = 1""",
        (token, db.now()),
    )
    if not row:
        return None
    row.pop("pass_hash", None)
    return row


def public_user(user):
    if not user:
        return None
    data = {k: v for k, v in user.items() if k != "pass_hash"}
    if data.get("customer_id"):
        data["customer"] = db.one("SELECT * FROM customers WHERE id = ?", (data["customer_id"],))
    return data


def require(user, roles):
    if user is None:
        raise ApiError(401, "Debe iniciar sesion")
    if roles and user["role"] not in roles:
        raise ApiError(403, "No tiene permisos para esta accion")
    return user
