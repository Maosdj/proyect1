"""Punto de venta: ventas, tickets, abonos a credito y control de caja."""

from . import db
from .auth import ApiError, STAFF, require
from .router import route
from .routes_inventory import apply_stock

METHODS = ("efectivo", "tarjeta", "transferencia", "credito")


def open_session():
    return db.one("SELECT * FROM cash_sessions WHERE status = 'abierta' ORDER BY id DESC LIMIT 1")


def customer_balance(customer_id):
    row = db.one(
        """SELECT COALESCE(SUM(balance), 0) AS pending FROM sales
            WHERE customer_id = ? AND is_credit = 1 AND status = 'completada'""",
        (customer_id,),
    )
    return round(row["pending"], 2)


def sale_detail(sale_id):
    sale = db.one(
        """SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, c.doc AS customer_doc,
                  c.address AS customer_address, u.name AS user_name
             FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
             LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?""",
        (sale_id,),
    )
    if not sale:
        raise ApiError(404, "Venta no encontrada")
    sale["items"] = db.query("SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id", (sale_id,))
    sale["payments"] = db.query("SELECT * FROM sale_payments WHERE sale_id = ?", (sale_id,))
    sale["credit_payments"] = db.query(
        "SELECT * FROM credit_payments WHERE sale_id = ? ORDER BY id", (sale_id,)
    )
    return sale


# ------------------------------------------------------------------ ventas

@route("POST", "/api/sales", roles=STAFF)
def create_sale(ctx):
    items = ctx.body.get("items") or []
    if not items:
        raise ApiError(400, "La venta no tiene productos")

    session = open_session()
    if not session:
        raise ApiError(400, "No hay caja abierta. Abra la caja antes de registrar ventas")

    customer_id = ctx.body.get("customer_id") or None
    is_credit = bool(ctx.body.get("is_credit"))
    if is_credit and not customer_id:
        raise ApiError(400, "Una venta a credito debe tener un cliente asociado")

    customer = None
    if customer_id:
        customer = db.one("SELECT * FROM customers WHERE id = ?", (int(customer_id),))
        if not customer:
            raise ApiError(404, "Cliente no encontrado")
        customer_id = customer["id"]

    # --- Validacion y calculo de lineas
    prepared, subtotal, cost_total = [], 0.0, 0.0
    for raw in items:
        pid = raw.get("product_id")
        qty = float(raw.get("qty") or 0)
        if qty <= 0:
            raise ApiError(400, "Cantidad invalida en la venta")
        product = db.one("SELECT * FROM products WHERE id = ?", (int(pid),)) if pid else None
        if not product:
            raise ApiError(404, "Producto no encontrado en la venta")
        if qty > product["stock"]:
            raise ApiError(400, "Stock insuficiente de %s (disponible: %s %s)"
                           % (product["name"], product["stock"], product["unit"]))
        price = float(raw.get("price", product["price"]))
        if not ctx.is_admin and abs(price - product["price"]) > 0.001:
            raise ApiError(403, "Solo el administrador puede cambiar el precio de un producto")
        line_disc = float(raw.get("discount") or 0)
        line_total = round(qty * price - line_disc, 2)
        if line_total < 0:
            raise ApiError(400, "El descuento supera el valor de la linea")
        prepared.append({
            "product": product, "qty": qty, "price": price,
            "discount": line_disc, "subtotal": line_total,
        })
        subtotal += line_total
        cost_total += product["cost"] * qty

    subtotal = round(subtotal, 2)
    discount = round(float(ctx.body.get("discount") or 0), 2)
    if discount < 0 or discount > subtotal:
        raise ApiError(400, "Descuento total invalido")
    total = round(subtotal - discount, 2)

    # --- Pagos
    payments = []
    for p in (ctx.body.get("payments") or []):
        method = p.get("method")
        amount = round(float(p.get("amount") or 0), 2)
        if method not in METHODS:
            raise ApiError(400, "Metodo de pago no valido: %s" % method)
        if amount > 0:
            payments.append({"method": method, "amount": amount})
    paid = round(sum(p["amount"] for p in payments), 2)

    if is_credit:
        balance = round(total - paid, 2)
        if balance <= 0:
            is_credit, balance = False, 0.0
        else:
            limit = customer["credit_limit"] or 0
            pending = customer_balance(customer_id)
            if limit > 0 and pending + balance > limit:
                raise ApiError(400, "Supera el cupo de credito de %s (cupo %.0f, pendiente %.0f)"
                               % (customer["name"], limit, pending))
    else:
        balance = 0.0
        if paid + 0.01 < total:
            raise ApiError(400, "El pago recibido (%.0f) es menor al total (%.0f)" % (paid, total))

    if len(payments) > 1:
        payment_type = "mixto"
    elif payments:
        payment_type = payments[0]["method"]
    else:
        payment_type = "credito"
    if is_credit and payment_type != "mixto":
        payment_type = "credito" if not payments else "mixto"

    ts = db.now()
    sale_id = db.insert("sales", {
        "folio": "TMP", "customer_id": customer_id, "user_id": ctx.user["id"],
        "cash_session_id": session["id"], "subtotal": subtotal, "discount": discount,
        "total": total, "cost_total": round(cost_total, 2), "paid": min(paid, total),
        "balance": balance, "payment_type": payment_type, "is_credit": 1 if is_credit else 0,
        "status": "completada", "note": ctx.text("note"), "created_at": ts,
    })
    db.update("sales", sale_id, {"folio": "V-%06d" % sale_id})

    for line in prepared:
        product = line["product"]
        db.insert("sale_items", {
            "sale_id": sale_id, "product_id": product["id"], "name": product["name"],
            "unit": product["unit"], "qty": line["qty"], "price": line["price"],
            "cost": product["cost"], "discount": line["discount"], "subtotal": line["subtotal"],
        })
        apply_stock(product["id"], -line["qty"], "salida",
                    "Venta V-%06d" % sale_id, "venta", sale_id, ctx.user["id"])

    for p in payments:
        db.insert("sale_payments", {"sale_id": sale_id, "method": p["method"], "amount": p["amount"]})

    order_id = ctx.body.get("order_id")
    if order_id:
        db.update("orders", int(order_id),
                  {"status": "entregado", "sale_id": sale_id, "updated_at": ts})

    return sale_detail(sale_id)


@route("GET", "/api/sales", roles=STAFF)
def list_sales(ctx):
    sql = """SELECT s.*, c.name AS customer_name, u.name AS user_name
               FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
               LEFT JOIN users u ON u.id = s.user_id WHERE 1=1"""
    args = []
    if ctx.q("from"):
        sql += " AND s.created_at >= ?"
        args.append(ctx.q("from") + " 00:00:00")
    if ctx.q("to"):
        sql += " AND s.created_at <= ?"
        args.append(ctx.q("to") + " 23:59:59")
    if ctx.qint("customer"):
        sql += " AND s.customer_id = ?"
        args.append(ctx.qint("customer"))
    if ctx.qint("user"):
        sql += " AND s.user_id = ?"
        args.append(ctx.qint("user"))
    if ctx.q("credit") == "1":
        sql += " AND s.is_credit = 1 AND s.balance > 0"
    if ctx.q("status"):
        sql += " AND s.status = ?"
        args.append(ctx.q("status"))
    if ctx.q("q"):
        sql += " AND (s.folio LIKE ? OR c.name LIKE ?)"
        term = "%%%s%%" % ctx.q("q")
        args += [term, term]
    # El cajero solo consulta sus propias ventas
    if ctx.user["role"] == "cajero":
        sql += " AND s.user_id = ?"
        args.append(ctx.user["id"])
    sql += " ORDER BY s.id DESC LIMIT ?"
    args.append(ctx.qint("limit", 100))
    rows = db.query(sql, args)
    totals = {
        "count": len(rows),
        "total": round(sum(r["total"] for r in rows if r["status"] == "completada"), 2),
        "pending": round(sum(r["balance"] for r in rows if r["status"] == "completada"), 2),
    }
    return {"items": rows, "totals": totals}


@route("GET", "/api/sales/{id}", roles=STAFF)
def get_sale(ctx):
    return sale_detail(ctx.param("id", cast=int))


@route("POST", "/api/sales/{id}/void", roles=("admin",))
def void_sale(ctx):
    sale_id = ctx.param("id", cast=int)
    sale = db.one("SELECT * FROM sales WHERE id = ?", (sale_id,))
    if not sale:
        raise ApiError(404, "Venta no encontrada")
    if sale["status"] == "anulada":
        raise ApiError(400, "La venta ya esta anulada")
    for item in db.query("SELECT * FROM sale_items WHERE sale_id = ?", (sale_id,)):
        if item["product_id"]:
            apply_stock(item["product_id"], item["qty"], "entrada",
                        "Anulacion %s" % sale["folio"], "anulacion", sale_id, ctx.user["id"])
    db.update("sales", sale_id, {
        "status": "anulada", "balance": 0,
        "note": (sale["note"] + " | Anulada: " + ctx.text("reason")).strip(" |"),
    })
    return sale_detail(sale_id)


# --------------------------------------------------------- abonos a credito

@route("POST", "/api/credits/payments", roles=STAFF)
def register_credit_payment(ctx):
    customer_id = int(ctx.need("customer_id"))
    amount = round(ctx.num("amount"), 2)
    if amount <= 0:
        raise ApiError(400, "El abono debe ser mayor a cero")
    customer = db.one("SELECT * FROM customers WHERE id = ?", (customer_id,))
    if not customer:
        raise ApiError(404, "Cliente no encontrado")
    pending = customer_balance(customer_id)
    if amount > pending + 0.01:
        raise ApiError(400, "El abono (%.0f) supera el saldo pendiente (%.0f)" % (amount, pending))

    method = ctx.text("method") or "efectivo"
    if method not in ("efectivo", "tarjeta", "transferencia"):
        raise ApiError(400, "Metodo de pago no valido")
    session = open_session()
    ts = db.now()
    remaining = amount

    # Se abona a las facturas mas antiguas primero.
    for sale in db.query(
        """SELECT * FROM sales WHERE customer_id = ? AND is_credit = 1
             AND status = 'completada' AND balance > 0 ORDER BY id ASC""",
        (customer_id,),
    ):
        if remaining <= 0:
            break
        applied = min(remaining, sale["balance"])
        db.update("sales", sale["id"], {
            "balance": round(sale["balance"] - applied, 2),
            "paid": round(sale["paid"] + applied, 2),
        })
        db.insert("credit_payments", {
            "customer_id": customer_id, "sale_id": sale["id"], "amount": applied,
            "method": method, "user_id": ctx.user["id"],
            "cash_session_id": session["id"] if session else None,
            "note": ctx.text("note"), "created_at": ts,
        })
        remaining = round(remaining - applied, 2)

    return {"ok": True, "applied": amount, "pending": customer_balance(customer_id)}


@route("GET", "/api/credits", roles=STAFF)
def list_credits(ctx):
    rows = db.query(
        """SELECT c.id, c.name, c.phone, c.type, c.farm_name, c.credit_limit,
                  COALESCE(SUM(s.balance), 0) AS pending,
                  COUNT(s.id) AS open_invoices,
                  MIN(s.created_at) AS oldest
             FROM customers c
             JOIN sales s ON s.customer_id = c.id AND s.is_credit = 1
                          AND s.status = 'completada' AND s.balance > 0
            GROUP BY c.id ORDER BY pending DESC"""
    )
    for r in rows:
        r["pending"] = round(r["pending"], 2)
        r["invoices"] = db.query(
            """SELECT id, folio, total, paid, balance, created_at FROM sales
                WHERE customer_id = ? AND is_credit = 1 AND status = 'completada' AND balance > 0
                ORDER BY id""",
            (r["id"],),
        )
    return {"items": rows, "total_pending": round(sum(r["pending"] for r in rows), 2)}


# -------------------------------------------------------------------- caja

def session_summary(session):
    sid = session["id"]
    by_method = db.query(
        """SELECT p.method, COALESCE(SUM(p.amount), 0) AS amount
             FROM sale_payments p JOIN sales s ON s.id = p.sale_id
            WHERE s.cash_session_id = ? AND s.status = 'completada'
            GROUP BY p.method""",
        (sid,),
    )
    methods = {m["method"]: round(m["amount"], 2) for m in by_method}
    sales_row = db.one(
        """SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total,
                  COALESCE(SUM(balance), 0) AS credit
             FROM sales WHERE cash_session_id = ? AND status = 'completada'""",
        (sid,),
    )
    credit_cash = db.one(
        """SELECT COALESCE(SUM(amount), 0) AS total FROM credit_payments
            WHERE cash_session_id = ? AND method = 'efectivo'""",
        (sid,),
    )["total"]
    credit_all = db.one(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM credit_payments WHERE cash_session_id = ?",
        (sid,),
    )["total"]
    movs = db.query(
        """SELECT type, COALESCE(SUM(amount), 0) AS total FROM cash_movements
            WHERE session_id = ? GROUP BY type""",
        (sid,),
    )
    ingresos = next((m["total"] for m in movs if m["type"] == "ingreso"), 0)
    egresos = next((m["total"] for m in movs if m["type"] == "egreso"), 0)
    expected = round(
        session["opening_amount"] + methods.get("efectivo", 0) + credit_cash + ingresos - egresos, 2
    )
    return {
        "sales_count": sales_row["n"],
        "sales_total": round(sales_row["total"], 2),
        "credit_granted": round(sales_row["credit"], 2),
        "cash": methods.get("efectivo", 0),
        "card": methods.get("tarjeta", 0),
        "transfer": methods.get("transferencia", 0),
        "credit_payments": round(credit_all, 2),
        "credit_payments_cash": round(credit_cash, 2),
        "ingresos": round(ingresos, 2),
        "egresos": round(egresos, 2),
        "expected_cash": expected,
    }


@route("GET", "/api/cash/current", roles=STAFF)
def current_cash(ctx):
    session = open_session()
    if not session:
        return {"session": None}
    session["opened_by_name"] = (db.one("SELECT name FROM users WHERE id = ?",
                                        (session["opened_by"],)) or {}).get("name")
    session["summary"] = session_summary(session)
    session["movements"] = db.query(
        """SELECT m.*, u.name AS user_name FROM cash_movements m
             LEFT JOIN users u ON u.id = m.user_id
            WHERE m.session_id = ? ORDER BY m.id DESC""",
        (session["id"],),
    )
    session["sales"] = db.query(
        """SELECT s.id, s.folio, s.total, s.payment_type, s.created_at, c.name AS customer_name
             FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
            WHERE s.cash_session_id = ? AND s.status = 'completada'
            ORDER BY s.id DESC LIMIT 50""",
        (session["id"],),
    )
    return {"session": session}


@route("POST", "/api/cash/open", roles=STAFF)
def open_cash(ctx):
    if open_session():
        raise ApiError(400, "Ya hay una caja abierta")
    amount = ctx.num("opening_amount")
    if amount < 0:
        raise ApiError(400, "El monto inicial no puede ser negativo")
    sid = db.insert("cash_sessions", {
        "opened_by": ctx.user["id"], "opening_amount": round(amount, 2),
        "opened_at": db.now(), "status": "abierta", "note": ctx.text("note"),
    })
    return db.one("SELECT * FROM cash_sessions WHERE id = ?", (sid,))


@route("POST", "/api/cash/close", roles=STAFF)
def close_cash(ctx):
    session = open_session()
    if not session:
        raise ApiError(400, "No hay caja abierta")
    counted = ctx.num("counted_amount")
    summary = session_summary(session)
    difference = round(counted - summary["expected_cash"], 2)
    db.update("cash_sessions", session["id"], {
        "closed_by": ctx.user["id"], "closed_at": db.now(), "counted_amount": round(counted, 2),
        "expected_amount": summary["expected_cash"], "difference": difference,
        "status": "cerrada",
        "note": (session["note"] + " " + ctx.text("note")).strip(),
    })
    closed = db.one("SELECT * FROM cash_sessions WHERE id = ?", (session["id"],))
    closed["summary"] = summary
    return closed


@route("POST", "/api/cash/movements", roles=STAFF)
def cash_movement(ctx):
    session = open_session()
    if not session:
        raise ApiError(400, "No hay caja abierta")
    mtype = ctx.text("type")
    if mtype not in ("ingreso", "egreso"):
        raise ApiError(400, "Tipo de movimiento no valido")
    amount = ctx.num("amount")
    if amount <= 0:
        raise ApiError(400, "El monto debe ser mayor a cero")
    db.insert("cash_movements", {
        "session_id": session["id"], "type": mtype, "amount": round(amount, 2),
        "concept": ctx.text("concept"), "user_id": ctx.user["id"], "created_at": db.now(),
    })
    return {"ok": True}


@route("GET", "/api/cash/sessions", roles=STAFF)
def cash_history(ctx):
    rows = db.query(
        """SELECT cs.*, uo.name AS opened_by_name, uc.name AS closed_by_name
             FROM cash_sessions cs
             LEFT JOIN users uo ON uo.id = cs.opened_by
             LEFT JOIN users uc ON uc.id = cs.closed_by
            ORDER BY cs.id DESC LIMIT ?""",
        (ctx.qint("limit", 30),),
    )
    return {"items": rows}
