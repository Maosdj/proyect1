"""Productos, categorias, proveedores y movimientos de inventario."""

from . import db
from .auth import ApiError, STAFF, require
from .router import route

UNITS = ("unidad", "kg", "libra", "litro", "galon", "bulto", "metro", "caja", "rollo")

PRODUCT_SELECT = """
    SELECT p.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
           s.name AS supplier_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN suppliers s ON s.id = p.supplier_id
"""


def stock_state(p):
    if p["stock"] <= 0:
        return "agotado"
    if p["min_stock"] and p["stock"] <= p["min_stock"]:
        return "bajo"
    return "ok"


def decorate(p):
    p["stock_state"] = stock_state(p)
    p["margin"] = round(p["price"] - p["cost"], 2)
    p["margin_pct"] = round(((p["price"] - p["cost"]) / p["price"] * 100) if p["price"] else 0, 1)
    return p


# ---------------------------------------------------------------- productos

@route("GET", "/api/products", roles=STAFF)
def list_products(ctx):
    sql = PRODUCT_SELECT + " WHERE 1=1"
    args = []
    if ctx.q("q"):
        term = "%%%s%%" % ctx.q("q").strip()
        sql += " AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.description LIKE ?)"
        args += [term, term, term, term]
    if ctx.qint("category"):
        sql += " AND p.category_id = ?"
        args.append(ctx.qint("category"))
    if ctx.qint("supplier"):
        sql += " AND p.supplier_id = ?"
        args.append(ctx.qint("supplier"))
    if ctx.q("stock") == "bajo":
        sql += " AND p.stock > 0 AND p.min_stock > 0 AND p.stock <= p.min_stock"
    elif ctx.q("stock") == "agotado":
        sql += " AND p.stock <= 0"
    elif ctx.q("stock") == "alerta":
        sql += " AND (p.stock <= 0 OR (p.min_stock > 0 AND p.stock <= p.min_stock))"
    if ctx.q("active") != "all":
        sql += " AND p.active = 1"
    sql += " ORDER BY p.name COLLATE NOCASE LIMIT ?"
    args.append(ctx.qint("limit", 500))
    return {"items": [decorate(p) for p in db.query(sql, args)]}


@route("GET", "/api/products/scan", roles=STAFF)
def scan_product(ctx):
    """Busqueda exacta por codigo de barras o SKU (lector de codigo)."""
    code = (ctx.q("code") or "").strip()
    if not code:
        raise ApiError(400, "Codigo vacio")
    p = db.one(PRODUCT_SELECT + " WHERE p.active = 1 AND (p.barcode = ? OR p.sku = ?)", (code, code))
    if not p:
        raise ApiError(404, "No se encontro un producto con el codigo %s" % code)
    return decorate(p)


@route("GET", "/api/products/{id}", roles=STAFF)
def get_product(ctx):
    p = db.one(PRODUCT_SELECT + " WHERE p.id = ?", (ctx.param("id", cast=int),))
    if not p:
        raise ApiError(404, "Producto no encontrado")
    p["moves"] = db.query(
        """SELECT m.*, u.name AS user_name FROM inventory_moves m
           LEFT JOIN users u ON u.id = m.user_id
           WHERE m.product_id = ? ORDER BY m.id DESC LIMIT 50""",
        (p["id"],),
    )
    return decorate(p)


def _product_payload(ctx):
    unit = ctx.text("unit") or "unidad"
    if unit not in UNITS:
        raise ApiError(400, "Unidad de medida no valida")
    price = ctx.num("price")
    cost = ctx.num("cost")
    if price < 0 or cost < 0:
        raise ApiError(400, "Los precios no pueden ser negativos")
    return {
        "sku": ctx.text("sku"),
        "barcode": ctx.text("barcode"),
        "name": ctx.need("name"),
        "description": ctx.text("description"),
        "category_id": int(ctx.body["category_id"]) if ctx.body.get("category_id") else None,
        "supplier_id": int(ctx.body["supplier_id"]) if ctx.body.get("supplier_id") else None,
        "cost": round(cost, 2),
        "price": round(price, 2),
        "min_stock": ctx.num("min_stock"),
        "unit": unit,
        "image": ctx.text("image") or "\U0001F4E6",
        "visible": 1 if ctx.body.get("visible", True) else 0,
        "active": 1 if ctx.body.get("active", True) else 0,
    }


@route("POST", "/api/products", roles=("admin",))
def create_product(ctx):
    data = _product_payload(ctx)
    stock = ctx.num("stock")
    data["stock"] = stock
    data["created_at"] = db.now()
    if data["barcode"] and db.one("SELECT id FROM products WHERE barcode = ?", (data["barcode"],)):
        raise ApiError(409, "Ya existe un producto con ese codigo de barras")
    pid = db.insert("products", data)
    if stock:
        _register_move(pid, "entrada", stock, 0, stock, "Stock inicial", "manual", None, ctx.user["id"])
    return db.one(PRODUCT_SELECT + " WHERE p.id = ?", (pid,))


@route("PUT", "/api/products/{id}", roles=("admin",))
def edit_product(ctx):
    pid = ctx.param("id", cast=int)
    current = db.one("SELECT * FROM products WHERE id = ?", (pid,))
    if not current:
        raise ApiError(404, "Producto no encontrado")
    data = _product_payload(ctx)
    if data["barcode"]:
        dup = db.one("SELECT id FROM products WHERE barcode = ? AND id <> ?", (data["barcode"], pid))
        if dup:
            raise ApiError(409, "Ya existe otro producto con ese codigo de barras")
    db.update("products", pid, data)
    # El stock solo cambia por movimientos, nunca por edicion directa del formulario.
    return db.one(PRODUCT_SELECT + " WHERE p.id = ?", (pid,))


@route("DELETE", "/api/products/{id}", roles=("admin",))
def delete_product(ctx):
    pid = ctx.param("id", cast=int)
    if not db.one("SELECT id FROM products WHERE id = ?", (pid,)):
        raise ApiError(404, "Producto no encontrado")
    used = db.one("SELECT id FROM sale_items WHERE product_id = ? LIMIT 1", (pid,))
    if used:
        db.update("products", pid, {"active": 0, "visible": 0})
        return {"ok": True, "archived": True,
                "message": "El producto tiene ventas asociadas: se desactivo en lugar de borrarse"}
    db.execute("DELETE FROM inventory_moves WHERE product_id = ?", (pid,))
    db.execute("DELETE FROM products WHERE id = ?", (pid,))
    return {"ok": True, "archived": False}


# ------------------------------------------------------------- inventario

def _register_move(product_id, mtype, qty, before, after, reason, ref_type, ref_id, user_id):
    db.insert("inventory_moves", {
        "product_id": product_id, "type": mtype, "qty": qty, "stock_before": before,
        "stock_after": after, "reason": reason, "ref_type": ref_type, "ref_id": ref_id,
        "user_id": user_id, "created_at": db.now(),
    })


def apply_stock(product_id, delta, mtype, reason, ref_type, ref_id, user_id):
    """Aplica un cambio de stock y deja rastro en el historial."""
    p = db.one("SELECT id, stock FROM products WHERE id = ?", (product_id,))
    if not p:
        return None
    before = p["stock"]
    after = round(before + delta, 3)
    db.update("products", product_id, {"stock": after})
    _register_move(product_id, mtype, abs(delta), before, after, reason, ref_type, ref_id, user_id)
    return after


@route("GET", "/api/inventory/moves", roles=STAFF)
def list_moves(ctx):
    sql = """SELECT m.*, p.name AS product_name, p.unit, u.name AS user_name
               FROM inventory_moves m
               LEFT JOIN products p ON p.id = m.product_id
               LEFT JOIN users u ON u.id = m.user_id WHERE 1=1"""
    args = []
    if ctx.qint("product"):
        sql += " AND m.product_id = ?"
        args.append(ctx.qint("product"))
    if ctx.q("type"):
        sql += " AND m.type = ?"
        args.append(ctx.q("type"))
    if ctx.q("from"):
        sql += " AND m.created_at >= ?"
        args.append(ctx.q("from") + " 00:00:00")
    if ctx.q("to"):
        sql += " AND m.created_at <= ?"
        args.append(ctx.q("to") + " 23:59:59")
    sql += " ORDER BY m.id DESC LIMIT ?"
    args.append(ctx.qint("limit", 200))
    return {"items": db.query(sql, args)}


@route("POST", "/api/inventory/moves", roles=("admin",))
def create_move(ctx):
    """Entrada de mercancia, salida por merma o ajuste de conteo."""
    product_id = int(ctx.need("product_id"))
    mtype = ctx.text("type")
    if mtype not in ("entrada", "salida", "ajuste"):
        raise ApiError(400, "Tipo de movimiento no valido")
    qty = ctx.num("qty")
    p = db.one("SELECT * FROM products WHERE id = ?", (product_id,))
    if not p:
        raise ApiError(404, "Producto no encontrado")

    if mtype == "ajuste":
        delta = round(qty - p["stock"], 3)   # en ajuste, qty = conteo real
    elif mtype == "entrada":
        if qty <= 0:
            raise ApiError(400, "La cantidad debe ser mayor a cero")
        delta = qty
    else:
        if qty <= 0:
            raise ApiError(400, "La cantidad debe ser mayor a cero")
        if qty > p["stock"]:
            raise ApiError(400, "No puede sacar mas de las %s existencias" % p["stock"])
        delta = -qty

    cost = ctx.num("cost")
    if mtype == "entrada" and cost > 0 and cost != p["cost"]:
        db.update("products", product_id, {"cost": round(cost, 2)})

    after = apply_stock(product_id, delta, mtype, ctx.text("reason") or "Movimiento manual",
                        "manual", None, ctx.user["id"])
    return {"ok": True, "stock": after}


# ------------------------------------------------------------- categorias

@route("GET", "/api/categories")
def list_categories(ctx):
    rows = db.query(
        """SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1)
                  AS product_count
             FROM categories c ORDER BY c.name COLLATE NOCASE"""
    )
    return {"items": rows}


@route("POST", "/api/categories", roles=("admin",))
def create_category(ctx):
    name = ctx.need("name")
    if db.one("SELECT id FROM categories WHERE lower(name) = ?", (name.lower(),)):
        raise ApiError(409, "Ya existe una categoria con ese nombre")
    cid = db.insert("categories", {
        "name": name, "icon": ctx.text("icon") or "\U0001F4E6",
        "color": ctx.text("color") or "#8b5e34", "created_at": db.now(),
    })
    return db.one("SELECT * FROM categories WHERE id = ?", (cid,))


@route("PUT", "/api/categories/{id}", roles=("admin",))
def edit_category(ctx):
    cid = ctx.param("id", cast=int)
    if not db.one("SELECT id FROM categories WHERE id = ?", (cid,)):
        raise ApiError(404, "Categoria no encontrada")
    db.update("categories", cid, {
        "name": ctx.need("name"), "icon": ctx.text("icon"), "color": ctx.text("color"),
    })
    return db.one("SELECT * FROM categories WHERE id = ?", (cid,))


@route("DELETE", "/api/categories/{id}", roles=("admin",))
def delete_category(ctx):
    cid = ctx.param("id", cast=int)
    if db.one("SELECT id FROM products WHERE category_id = ? LIMIT 1", (cid,)):
        raise ApiError(400, "No se puede eliminar: hay productos en esta categoria")
    db.execute("DELETE FROM categories WHERE id = ?", (cid,))
    return {"ok": True}


# ------------------------------------------------------------- proveedores

@route("GET", "/api/suppliers", roles=STAFF)
def list_suppliers(ctx):
    rows = db.query(
        """SELECT s.*, (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id AND p.active = 1)
                  AS product_count
             FROM suppliers s ORDER BY s.name COLLATE NOCASE"""
    )
    for s in rows:
        s["products"] = db.query(
            "SELECT id, name, stock, unit FROM products WHERE supplier_id = ? AND active = 1 ORDER BY name",
            (s["id"],),
        )
    return {"items": rows}


@route("POST", "/api/suppliers", roles=("admin",))
def create_supplier(ctx):
    sid = db.insert("suppliers", {
        "name": ctx.need("name"), "contact": ctx.text("contact"), "phone": ctx.text("phone"),
        "email": ctx.text("email"), "address": ctx.text("address"), "notes": ctx.text("notes"),
        "active": 1, "created_at": db.now(),
    })
    return db.one("SELECT * FROM suppliers WHERE id = ?", (sid,))


@route("PUT", "/api/suppliers/{id}", roles=("admin",))
def edit_supplier(ctx):
    sid = ctx.param("id", cast=int)
    if not db.one("SELECT id FROM suppliers WHERE id = ?", (sid,)):
        raise ApiError(404, "Proveedor no encontrado")
    db.update("suppliers", sid, {
        "name": ctx.need("name"), "contact": ctx.text("contact"), "phone": ctx.text("phone"),
        "email": ctx.text("email"), "address": ctx.text("address"), "notes": ctx.text("notes"),
    })
    return db.one("SELECT * FROM suppliers WHERE id = ?", (sid,))


@route("DELETE", "/api/suppliers/{id}", roles=("admin",))
def delete_supplier(ctx):
    sid = ctx.param("id", cast=int)
    if db.one("SELECT id FROM products WHERE supplier_id = ? LIMIT 1", (sid,)):
        raise ApiError(400, "No se puede eliminar: tiene productos asociados")
    db.execute("DELETE FROM suppliers WHERE id = ?", (sid,))
    return {"ok": True}


# ------------------------------------------------------- catalogo publico

@route("GET", "/api/catalog")
def catalog(ctx):
    sql = """SELECT p.id, p.name, p.description, p.price, p.stock, p.unit, p.image, p.sku,
                    p.category_id, c.name AS category_name, c.icon AS category_icon,
                    c.color AS category_color
               FROM products p LEFT JOIN categories c ON c.id = p.category_id
              WHERE p.active = 1 AND p.visible = 1"""
    args = []
    if ctx.q("q"):
        term = "%%%s%%" % ctx.q("q").strip()
        sql += " AND (p.name LIKE ? OR p.description LIKE ? OR c.name LIKE ?)"
        args += [term, term, term]
    if ctx.qint("category"):
        sql += " AND p.category_id = ?"
        args.append(ctx.qint("category"))
    if ctx.q("available") == "1":
        sql += " AND p.stock > 0"
    min_price, max_price = ctx.qint("min_price"), ctx.qint("max_price")
    if min_price is not None:
        sql += " AND p.price >= ?"
        args.append(min_price)
    if max_price is not None:
        sql += " AND p.price <= ?"
        args.append(max_price)
    order = {"precio_asc": "p.price ASC", "precio_desc": "p.price DESC",
             "nombre": "p.name COLLATE NOCASE"}.get(ctx.q("sort"), "p.name COLLATE NOCASE")
    sql += " ORDER BY " + order + " LIMIT 300"
    items = db.query(sql, args)
    for it in items:
        it["available"] = it["stock"] > 0
    return {"items": items}
