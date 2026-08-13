"""Gestion de usuarios del sistema y configuracion del negocio."""

from . import auth, db
from .auth import ApiError, STAFF
from .router import route


@route("GET", "/api/users", roles=("admin",))
def list_users(ctx):
    rows = db.query(
        """SELECT u.id, u.name, u.email, u.phone, u.role, u.active, u.created_at,
                  u.customer_id, c.name AS customer_name,
                  (SELECT COUNT(*) FROM sales s WHERE s.user_id = u.id AND s.status='completada')
                    AS sales_count
             FROM users u LEFT JOIN customers c ON c.id = u.customer_id
            ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'cajero' THEN 1 ELSE 2 END,
                     u.name COLLATE NOCASE"""
    )
    return {"items": rows}


@route("POST", "/api/users", roles=("admin",))
def create_user(ctx):
    name = ctx.need("name")
    email = ctx.text("email").lower()
    password = ctx.body.get("password") or ""
    role = ctx.text("role")
    if role not in auth.ROLES:
        raise ApiError(400, "Rol no valido")
    if "@" not in email:
        raise ApiError(400, "Correo no valido")
    if len(password) < 6:
        raise ApiError(400, "La contrasena debe tener al menos 6 caracteres")
    if db.one("SELECT id FROM users WHERE lower(email) = ?", (email,)):
        raise ApiError(409, "Ya existe un usuario con ese correo")
    customer_id = ctx.body.get("customer_id") or None
    if role == "cliente" and not customer_id:
        raise ApiError(400, "Un usuario cliente debe estar ligado a una ficha de cliente")
    uid = db.insert("users", {
        "name": name, "email": email, "phone": ctx.text("phone"), "role": role,
        "pass_hash": auth.hash_password(password),
        "customer_id": int(customer_id) if customer_id else None,
        "active": 1 if ctx.body.get("active", True) else 0, "created_at": db.now(),
    })
    return db.one("SELECT id, name, email, phone, role, active FROM users WHERE id = ?", (uid,))


@route("PUT", "/api/users/{id}", roles=("admin",))
def edit_user(ctx):
    uid = ctx.param("id", cast=int)
    user = db.one("SELECT * FROM users WHERE id = ?", (uid,))
    if not user:
        raise ApiError(404, "Usuario no encontrado")
    role = ctx.text("role") or user["role"]
    if role not in auth.ROLES:
        raise ApiError(400, "Rol no valido")
    active = 1 if ctx.body.get("active", bool(user["active"])) else 0
    if user["id"] == ctx.user["id"] and (role != "admin" or not active):
        raise ApiError(400, "No puede quitarse a si mismo el acceso de administrador")
    data = {
        "name": ctx.need("name"), "phone": ctx.text("phone"), "role": role, "active": active,
    }
    email = ctx.text("email").lower()
    if email and email != user["email"]:
        if db.one("SELECT id FROM users WHERE lower(email) = ? AND id <> ?", (email, uid)):
            raise ApiError(409, "Ya existe otro usuario con ese correo")
        data["email"] = email
    if ctx.body.get("password"):
        if len(ctx.body["password"]) < 6:
            raise ApiError(400, "La contrasena debe tener al menos 6 caracteres")
        data["pass_hash"] = auth.hash_password(ctx.body["password"])
    if "customer_id" in ctx.body:
        data["customer_id"] = int(ctx.body["customer_id"]) if ctx.body["customer_id"] else None
    db.update("users", uid, data)
    if not active:
        db.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
    return db.one("SELECT id, name, email, phone, role, active FROM users WHERE id = ?", (uid,))


@route("DELETE", "/api/users/{id}", roles=("admin",))
def delete_user(ctx):
    uid = ctx.param("id", cast=int)
    if uid == ctx.user["id"]:
        raise ApiError(400, "No puede eliminar su propio usuario")
    if not db.one("SELECT id FROM users WHERE id = ?", (uid,)):
        raise ApiError(404, "Usuario no encontrado")
    if db.one("SELECT id FROM sales WHERE user_id = ? LIMIT 1", (uid,)):
        db.update("users", uid, {"active": 0})
        db.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
        return {"ok": True, "archived": True,
                "message": "El usuario tiene ventas registradas: se desactivo en lugar de borrarse"}
    db.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
    db.execute("DELETE FROM users WHERE id = ?", (uid,))
    return {"ok": True}


@route("GET", "/api/settings")
def get_settings(ctx):
    rows = db.query("SELECT key, value FROM settings")
    return {r["key"]: r["value"] for r in rows}


@route("PUT", "/api/settings", roles=("admin",))
def save_settings(ctx):
    allowed = ("business_name", "business_short", "address", "phone", "nit", "currency",
               "ticket_footer", "low_stock_alert")
    for key in allowed:
        if key in ctx.body:
            db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                       (key, str(ctx.body[key])))
    rows = db.query("SELECT key, value FROM settings")
    return {r["key"]: r["value"] for r in rows}


@route("GET", "/api/bootstrap")
def bootstrap(ctx):
    """Datos comunes que la interfaz necesita al arrancar."""
    settings = {r["key"]: r["value"] for r in db.query("SELECT key, value FROM settings")}
    data = {
        "settings": settings,
        "categories": db.query("SELECT * FROM categories ORDER BY name COLLATE NOCASE"),
        "user": auth.public_user(ctx.user) if ctx.user else None,
    }
    if ctx.user and ctx.user["role"] in STAFF:
        data["cash_open"] = bool(db.one("SELECT id FROM cash_sessions WHERE status = 'abierta'"))
        data["alerts"] = db.one(
            """SELECT COUNT(*) AS low_stock FROM products
                WHERE active = 1 AND (stock <= 0 OR (min_stock > 0 AND stock <= min_stock))"""
        )["low_stock"]
        data["pending_orders"] = db.one(
            "SELECT COUNT(*) AS n FROM orders WHERE status IN ('pendiente','aprobado','listo')"
        )["n"]
    return data
