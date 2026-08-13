"""Endpoints de sesion y registro."""

from . import auth, db
from .auth import ApiError
from .router import route


@route("POST", "/api/auth/login")
def login(ctx):
    email = ctx.text("email").lower()
    password = ctx.body.get("password") or ""
    if not email or not password:
        raise ApiError(400, "Ingrese correo y contrasena")
    user = db.one("SELECT * FROM users WHERE lower(email) = ?", (email,))
    if not user or not auth.verify_password(password, user["pass_hash"]):
        raise ApiError(401, "Correo o contrasena incorrectos")
    if not user["active"]:
        raise ApiError(403, "Usuario inactivo. Consulte al administrador")
    token = auth.create_session(user["id"])
    return {"token": token, "user": auth.public_user(user)}


@route("POST", "/api/auth/register")
def register(ctx):
    """Registro publico: siempre crea un usuario con rol cliente."""
    name = ctx.need("name")
    email = ctx.text("email").lower()
    password = ctx.body.get("password") or ""
    if not email or "@" not in email:
        raise ApiError(400, "Ingrese un correo valido")
    if len(password) < 6:
        raise ApiError(400, "La contrasena debe tener al menos 6 caracteres")
    if db.one("SELECT id FROM users WHERE lower(email) = ?", (email,)):
        raise ApiError(409, "Ya existe una cuenta con ese correo")

    ts = db.now()
    customer_id = db.insert("customers", {
        "name": name,
        "doc": ctx.text("doc"),
        "phone": ctx.text("phone"),
        "email": email,
        "address": ctx.text("address"),
        "type": ctx.text("type") or "particular",
        "farm_name": ctx.text("farm_name"),
        "credit_limit": 0,
        "created_at": ts,
    })
    user_id = db.insert("users", {
        "name": name, "email": email, "phone": ctx.text("phone"), "role": "cliente",
        "pass_hash": auth.hash_password(password), "customer_id": customer_id,
        "active": 1, "created_at": ts,
    })
    token = auth.create_session(user_id)
    user = db.one("SELECT * FROM users WHERE id = ?", (user_id,))
    return {"token": token, "user": auth.public_user(user)}


@route("GET", "/api/auth/me")
def me(ctx):
    if not ctx.user:
        raise ApiError(401, "Sesion no valida")
    return {"user": auth.public_user(ctx.user)}


@route("POST", "/api/auth/logout")
def logout(ctx):
    auth.destroy_session(ctx.token)
    return {"ok": True}


@route("POST", "/api/auth/password")
def change_password(ctx):
    auth.require(ctx.user, None)
    current = ctx.body.get("current") or ""
    new = ctx.body.get("new") or ""
    if len(new) < 6:
        raise ApiError(400, "La nueva contrasena debe tener al menos 6 caracteres")
    row = db.one("SELECT pass_hash FROM users WHERE id = ?", (ctx.user["id"],))
    if not auth.verify_password(current, row["pass_hash"]):
        raise ApiError(400, "La contrasena actual no es correcta")
    db.update("users", ctx.user["id"], {"pass_hash": auth.hash_password(new)})
    return {"ok": True}
