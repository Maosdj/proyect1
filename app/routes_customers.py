"""Clientes, pedidos/cotizaciones y area privada del cliente."""

from . import db
from .auth import ApiError, STAFF, require
from .router import route
from .routes_sales import customer_balance

ORDER_STATUS = ("pendiente", "aprobado", "listo", "entregado", "cancelado")


def my_customer_id(ctx):
    require(ctx.user, ("cliente",))
    if not ctx.user.get("customer_id"):
        raise ApiError(400, "Su usuario no tiene una ficha de cliente asociada")
    return ctx.user["customer_id"]


def order_detail(order_id):
    order = db.one(
        """SELECT o.*, c.name AS customer_name, c.phone AS customer_phone,
                  c.address AS customer_address, c.type AS customer_type, c.farm_name
             FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?""",
        (order_id,),
    )
    if not order:
        raise ApiError(404, "Pedido no encontrado")
    order["items"] = db.query("SELECT * FROM order_items WHERE order_id = ? ORDER BY id", (order_id,))
    return order


def build_order(customer_id, body, otype):
    items = body.get("items") or []
    if not items:
        raise ApiError(400, "El pedido no tiene productos")
    prepared, total = [], 0.0
    for raw in items:
        product = db.one("SELECT * FROM products WHERE id = ? AND active = 1",
                         (int(raw.get("product_id") or 0),))
        if not product:
            raise ApiError(404, "Producto no disponible en el catalogo")
        qty = float(raw.get("qty") or 0)
        if qty <= 0:
            raise ApiError(400, "Cantidad invalida en el pedido")
        line = round(qty * product["price"], 2)
        prepared.append({
            "product_id": product["id"], "name": product["name"], "unit": product["unit"],
            "qty": qty, "price": product["price"], "subtotal": line,
        })
        total += line

    ts = db.now()
    order_id = db.insert("orders", {
        "folio": "TMP", "customer_id": customer_id, "type": otype, "status": "pendiente",
        "total": round(total, 2), "note": (body.get("note") or "").strip(),
        "created_at": ts, "updated_at": ts,
    })
    prefix = "COT" if otype == "cotizacion" else "PED"
    db.update("orders", order_id, {"folio": "%s-%05d" % (prefix, order_id)})
    for line in prepared:
        line["order_id"] = order_id
        db.insert("order_items", line)
    return order_detail(order_id)


# ---------------------------------------------------------------- clientes

@route("GET", "/api/customers", roles=STAFF)
def list_customers(ctx):
    sql = "SELECT * FROM customers WHERE 1=1"
    args = []
    if ctx.q("q"):
        term = "%%%s%%" % ctx.q("q").strip()
        sql += " AND (name LIKE ? OR phone LIKE ? OR doc LIKE ? OR farm_name LIKE ?)"
        args += [term, term, term, term]
    if ctx.q("type"):
        sql += " AND type = ?"
        args.append(ctx.q("type"))
    sql += " ORDER BY name COLLATE NOCASE LIMIT ?"
    args.append(ctx.qint("limit", 300))
    rows = db.query(sql, args)
    for c in rows:
        c["pending"] = customer_balance(c["id"])
        stats = db.one(
            """SELECT COUNT(*) AS purchases, COALESCE(SUM(total), 0) AS spent,
                      MAX(created_at) AS last_purchase
                 FROM sales WHERE customer_id = ? AND status = 'completada'""",
            (c["id"],),
        )
        c.update(stats)
    return {"items": rows}


@route("GET", "/api/customers/{id}", roles=STAFF)
def get_customer(ctx):
    cid = ctx.param("id", cast=int)
    customer = db.one("SELECT * FROM customers WHERE id = ?", (cid,))
    if not customer:
        raise ApiError(404, "Cliente no encontrado")
    customer["pending"] = customer_balance(cid)
    customer["sales"] = db.query(
        """SELECT s.*, u.name AS user_name FROM sales s LEFT JOIN users u ON u.id = s.user_id
            WHERE s.customer_id = ? ORDER BY s.id DESC LIMIT 100""",
        (cid,),
    )
    for s in customer["sales"]:
        s["items"] = db.query("SELECT * FROM sale_items WHERE sale_id = ?", (s["id"],))
    customer["credit_payments"] = db.query(
        """SELECT cp.*, u.name AS user_name, s.folio FROM credit_payments cp
             LEFT JOIN users u ON u.id = cp.user_id LEFT JOIN sales s ON s.id = cp.sale_id
            WHERE cp.customer_id = ? ORDER BY cp.id DESC LIMIT 100""",
        (cid,),
    )
    customer["orders"] = db.query(
        "SELECT * FROM orders WHERE customer_id = ? ORDER BY id DESC LIMIT 50", (cid,)
    )
    customer["user"] = db.one(
        "SELECT id, email, active FROM users WHERE customer_id = ?", (cid,)
    )
    return customer


def _customer_payload(ctx):
    ctype = ctx.text("type") or "particular"
    if ctype not in ("particular", "finca"):
        raise ApiError(400, "Tipo de cliente no valido")
    return {
        "name": ctx.need("name"), "doc": ctx.text("doc"), "phone": ctx.text("phone"),
        "email": ctx.text("email"), "address": ctx.text("address"), "type": ctype,
        "farm_name": ctx.text("farm_name"), "credit_limit": ctx.num("credit_limit"),
        "notes": ctx.text("notes"),
    }


@route("POST", "/api/customers", roles=STAFF)
def create_customer(ctx):
    data = _customer_payload(ctx)
    if ctx.user["role"] != "admin":
        data["credit_limit"] = 0     # solo el administrador asigna cupo
    data["created_at"] = db.now()
    cid = db.insert("customers", data)
    return db.one("SELECT * FROM customers WHERE id = ?", (cid,))


@route("PUT", "/api/customers/{id}", roles=STAFF)
def edit_customer(ctx):
    cid = ctx.param("id", cast=int)
    current = db.one("SELECT * FROM customers WHERE id = ?", (cid,))
    if not current:
        raise ApiError(404, "Cliente no encontrado")
    data = _customer_payload(ctx)
    if ctx.user["role"] != "admin":
        data.pop("credit_limit")
    db.update("customers", cid, data)
    return db.one("SELECT * FROM customers WHERE id = ?", (cid,))


@route("DELETE", "/api/customers/{id}", roles=("admin",))
def delete_customer(ctx):
    cid = ctx.param("id", cast=int)
    if customer_balance(cid) > 0:
        raise ApiError(400, "No se puede eliminar: el cliente tiene saldo pendiente")
    if db.one("SELECT id FROM sales WHERE customer_id = ? LIMIT 1", (cid,)):
        db.update("customers", cid, {"active": 0})
        return {"ok": True, "archived": True,
                "message": "El cliente tiene compras registradas: se marco como inactivo"}
    db.execute("DELETE FROM orders WHERE customer_id = ?", (cid,))
    db.execute("DELETE FROM customers WHERE id = ?", (cid,))
    return {"ok": True}


# ----------------------------------------------------------------- pedidos

@route("GET", "/api/orders", roles=STAFF)
def list_orders(ctx):
    sql = """SELECT o.*, c.name AS customer_name, c.phone AS customer_phone, c.type AS customer_type
               FROM orders o JOIN customers c ON c.id = o.customer_id WHERE 1=1"""
    args = []
    if ctx.q("status"):
        sql += " AND o.status = ?"
        args.append(ctx.q("status"))
    if ctx.q("type"):
        sql += " AND o.type = ?"
        args.append(ctx.q("type"))
    if ctx.q("q"):
        term = "%%%s%%" % ctx.q("q")
        sql += " AND (o.folio LIKE ? OR c.name LIKE ?)"
        args += [term, term]
    sql += " ORDER BY CASE o.status WHEN 'pendiente' THEN 0 WHEN 'aprobado' THEN 1"
    sql += " WHEN 'listo' THEN 2 ELSE 3 END, o.id DESC LIMIT ?"
    args.append(ctx.qint("limit", 100))
    rows = db.query(sql, args)
    for o in rows:
        o["items"] = db.query("SELECT * FROM order_items WHERE order_id = ?", (o["id"],))
    pend = db.one("SELECT COUNT(*) AS n FROM orders WHERE status IN ('pendiente','aprobado','listo')")
    return {"items": rows, "pending_count": pend["n"]}


@route("GET", "/api/orders/{id}", roles=STAFF)
def get_order(ctx):
    return order_detail(ctx.param("id", cast=int))


@route("POST", "/api/orders", roles=STAFF)
def staff_create_order(ctx):
    customer_id = int(ctx.need("customer_id"))
    otype = ctx.text("type") or "pedido"
    if otype not in ("pedido", "cotizacion"):
        raise ApiError(400, "Tipo no valido")
    return build_order(customer_id, ctx.body, otype)


@route("PUT", "/api/orders/{id}/status", roles=STAFF)
def set_order_status(ctx):
    oid = ctx.param("id", cast=int)
    status = ctx.text("status")
    if status not in ORDER_STATUS:
        raise ApiError(400, "Estado no valido")
    order = db.one("SELECT * FROM orders WHERE id = ?", (oid,))
    if not order:
        raise ApiError(404, "Pedido no encontrado")
    if order["status"] == "entregado" and order["sale_id"]:
        raise ApiError(400, "El pedido ya fue facturado")
    db.update("orders", oid, {"status": status, "updated_at": db.now(),
                              "note": ctx.text("note") or order["note"]})
    return order_detail(oid)


# ------------------------------------------------------- area del cliente

@route("GET", "/api/me/summary", roles=("cliente",))
def my_summary(ctx):
    cid = my_customer_id(ctx)
    customer = db.one("SELECT * FROM customers WHERE id = ?", (cid,))
    stats = db.one(
        """SELECT COUNT(*) AS purchases, COALESCE(SUM(total), 0) AS spent
             FROM sales WHERE customer_id = ? AND status = 'completada'""",
        (cid,),
    )
    orders = db.one(
        """SELECT COUNT(*) AS open_orders FROM orders
            WHERE customer_id = ? AND status IN ('pendiente','aprobado','listo')""",
        (cid,),
    )
    return {
        "customer": customer,
        "pending_credit": customer_balance(cid),
        "purchases": stats["purchases"],
        "spent": round(stats["spent"], 2),
        "open_orders": orders["open_orders"],
    }


@route("GET", "/api/me/purchases", roles=("cliente",))
def my_purchases(ctx):
    cid = my_customer_id(ctx)
    rows = db.query(
        """SELECT id, folio, total, paid, balance, payment_type, is_credit, status, created_at
             FROM sales WHERE customer_id = ? ORDER BY id DESC LIMIT 100""",
        (cid,),
    )
    for s in rows:
        s["items"] = db.query("SELECT * FROM sale_items WHERE sale_id = ?", (s["id"],))
    return {"items": rows}


@route("GET", "/api/me/credit", roles=("cliente",))
def my_credit(ctx):
    cid = my_customer_id(ctx)
    customer = db.one("SELECT credit_limit FROM customers WHERE id = ?", (cid,))
    invoices = db.query(
        """SELECT id, folio, total, paid, balance, created_at FROM sales
            WHERE customer_id = ? AND is_credit = 1 AND status = 'completada' AND balance > 0
            ORDER BY id""",
        (cid,),
    )
    payments = db.query(
        """SELECT cp.amount, cp.method, cp.created_at, s.folio FROM credit_payments cp
             LEFT JOIN sales s ON s.id = cp.sale_id
            WHERE cp.customer_id = ? ORDER BY cp.id DESC LIMIT 50""",
        (cid,),
    )
    pending = customer_balance(cid)
    limit = customer["credit_limit"] or 0
    return {
        "pending": pending, "credit_limit": limit,
        "available": round(max(limit - pending, 0), 2) if limit else 0,
        "invoices": invoices, "payments": payments,
    }


@route("GET", "/api/me/orders", roles=("cliente",))
def my_orders(ctx):
    cid = my_customer_id(ctx)
    rows = db.query("SELECT * FROM orders WHERE customer_id = ? ORDER BY id DESC LIMIT 100", (cid,))
    for o in rows:
        o["items"] = db.query("SELECT * FROM order_items WHERE order_id = ?", (o["id"],))
    return {"items": rows}


@route("POST", "/api/me/orders", roles=("cliente",))
def create_my_order(ctx):
    cid = my_customer_id(ctx)
    otype = ctx.text("type") or "pedido"
    if otype not in ("pedido", "cotizacion"):
        raise ApiError(400, "Tipo no valido")
    return build_order(cid, ctx.body, otype)


@route("POST", "/api/me/orders/{id}/cancel", roles=("cliente",))
def cancel_my_order(ctx):
    cid = my_customer_id(ctx)
    oid = ctx.param("id", cast=int)
    order = db.one("SELECT * FROM orders WHERE id = ? AND customer_id = ?", (oid, cid))
    if not order:
        raise ApiError(404, "Pedido no encontrado")
    if order["status"] in ("entregado", "cancelado"):
        raise ApiError(400, "Este pedido ya no se puede cancelar")
    db.update("orders", oid, {"status": "cancelado", "updated_at": db.now()})
    return order_detail(oid)


@route("PUT", "/api/me/profile", roles=("cliente",))
def update_my_profile(ctx):
    cid = my_customer_id(ctx)
    data = {
        "name": ctx.need("name"), "doc": ctx.text("doc"), "phone": ctx.text("phone"),
        "address": ctx.text("address"), "farm_name": ctx.text("farm_name"),
    }
    ctype = ctx.text("type")
    if ctype in ("particular", "finca"):
        data["type"] = ctype
    db.update("customers", cid, data)
    db.update("users", ctx.user["id"], {"name": data["name"], "phone": data["phone"]})
    return db.one("SELECT * FROM customers WHERE id = ?", (cid,))
