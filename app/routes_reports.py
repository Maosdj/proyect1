"""Dashboard y reportes de ventas, ganancias e inventario."""

from datetime import datetime, timedelta

from . import db
from .auth import STAFF
from .router import route


def _range(ctx, default_days=30):
    to = ctx.q("to") or datetime.now().strftime("%Y-%m-%d")
    frm = ctx.q("from") or (datetime.now() - timedelta(days=default_days)).strftime("%Y-%m-%d")
    return frm + " 00:00:00", to + " 23:59:59", frm, to


def _totals(frm, to):
    row = db.one(
        """SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total,
                  COALESCE(SUM(cost_total), 0) AS cost, COALESCE(SUM(discount), 0) AS discount,
                  COALESCE(SUM(balance), 0) AS credit
             FROM sales WHERE status = 'completada' AND created_at BETWEEN ? AND ?""",
        (frm, to),
    )
    row["total"] = round(row["total"], 2)
    row["cost"] = round(row["cost"], 2)
    row["profit"] = round(row["total"] - row["cost"], 2)
    row["margin_pct"] = round(row["profit"] / row["total"] * 100, 1) if row["total"] else 0
    row["credit"] = round(row["credit"], 2)
    row["discount"] = round(row["discount"], 2)
    row["ticket_avg"] = round(row["total"] / row["count"], 2) if row["count"] else 0
    return row


def _top_products(frm, to, limit=10):
    return db.query(
        """SELECT i.product_id, i.name, i.unit, SUM(i.qty) AS qty,
                  SUM(i.subtotal) AS revenue,
                  SUM(i.subtotal - (i.cost * i.qty)) AS profit
             FROM sale_items i JOIN sales s ON s.id = i.sale_id
            WHERE s.status = 'completada' AND s.created_at BETWEEN ? AND ?
            GROUP BY i.product_id, i.name ORDER BY qty DESC LIMIT ?""",
        (frm, to, limit),
    )


@route("GET", "/api/reports/dashboard", roles=("admin",))
def dashboard(ctx):
    now = datetime.now()
    today = now.strftime("%Y-%m-%d")
    week_start = (now - timedelta(days=now.weekday())).strftime("%Y-%m-%d")
    month_start = now.strftime("%Y-%m-01")

    daily = db.query(
        """SELECT substr(created_at, 1, 10) AS day, COALESCE(SUM(total), 0) AS total,
                  COUNT(*) AS count, COALESCE(SUM(total - cost_total), 0) AS profit
             FROM sales WHERE status = 'completada' AND created_at >= ?
            GROUP BY day ORDER BY day""",
        ((now - timedelta(days=13)).strftime("%Y-%m-%d") + " 00:00:00",),
    )
    by_day = {d["day"]: d for d in daily}
    series = []
    for i in range(13, -1, -1):
        day = (now - timedelta(days=i)).strftime("%Y-%m-%d")
        d = by_day.get(day)
        series.append({"day": day, "label": day[8:10] + "/" + day[5:7],
                       "total": round(d["total"], 2) if d else 0,
                       "count": d["count"] if d else 0,
                       "profit": round(d["profit"], 2) if d else 0})

    low_stock = db.query(
        """SELECT p.id, p.name, p.stock, p.min_stock, p.unit, c.name AS category_name
             FROM products p LEFT JOIN categories c ON c.id = p.category_id
            WHERE p.active = 1 AND (p.stock <= 0 OR (p.min_stock > 0 AND p.stock <= p.min_stock))
            ORDER BY (p.stock <= 0) DESC, p.stock ASC LIMIT 25"""
    )
    credits = db.one(
        """SELECT COALESCE(SUM(balance), 0) AS pending, COUNT(DISTINCT customer_id) AS customers
             FROM sales WHERE is_credit = 1 AND status = 'completada' AND balance > 0"""
    )
    by_category = db.query(
        """SELECT COALESCE(c.name, 'Sin categoria') AS category, c.color,
                  SUM(i.subtotal) AS total, SUM(i.qty) AS qty
             FROM sale_items i JOIN sales s ON s.id = i.sale_id
             LEFT JOIN products p ON p.id = i.product_id
             LEFT JOIN categories c ON c.id = p.category_id
            WHERE s.status = 'completada' AND s.created_at >= ?
            GROUP BY category ORDER BY total DESC""",
        (month_start + " 00:00:00",),
    )
    inventory_value = db.one(
        """SELECT COALESCE(SUM(stock * cost), 0) AS cost_value,
                  COALESCE(SUM(stock * price), 0) AS sale_value,
                  COUNT(*) AS products FROM products WHERE active = 1"""
    )
    orders = db.one(
        "SELECT COUNT(*) AS pending FROM orders WHERE status IN ('pendiente','aprobado','listo')"
    )
    session = db.one("SELECT id FROM cash_sessions WHERE status = 'abierta' LIMIT 1")

    return {
        "today": _totals(today + " 00:00:00", today + " 23:59:59"),
        "week": _totals(week_start + " 00:00:00", today + " 23:59:59"),
        "month": _totals(month_start + " 00:00:00", today + " 23:59:59"),
        "series": series,
        "top_products": _top_products(month_start + " 00:00:00", today + " 23:59:59"),
        "low_stock": low_stock,
        "low_stock_count": len(low_stock),
        "credits": {"pending": round(credits["pending"], 2), "customers": credits["customers"]},
        "by_category": by_category,
        "inventory": {
            "cost_value": round(inventory_value["cost_value"], 2),
            "sale_value": round(inventory_value["sale_value"], 2),
            "products": inventory_value["products"],
        },
        "pending_orders": orders["pending"],
        "cash_open": bool(session),
        "recent_sales": db.query(
            """SELECT s.id, s.folio, s.total, s.payment_type, s.created_at,
                      c.name AS customer_name, u.name AS user_name
                 FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
                 LEFT JOIN users u ON u.id = s.user_id
                WHERE s.status = 'completada' ORDER BY s.id DESC LIMIT 8"""
        ),
    }


@route("GET", "/api/reports/sales", roles=("admin",))
def sales_report(ctx):
    frm, to, frm_d, to_d = _range(ctx)
    group = ctx.q("group") or "day"
    fmt = {"day": "%Y-%m-%d", "month": "%Y-%m", "week": "%Y-W%W"}.get(group, "%Y-%m-%d")
    series = db.query(
        """SELECT strftime(?, created_at) AS bucket, COUNT(*) AS count,
                  COALESCE(SUM(total), 0) AS total,
                  COALESCE(SUM(total - cost_total), 0) AS profit
             FROM sales WHERE status = 'completada' AND created_at BETWEEN ? AND ?
            GROUP BY bucket ORDER BY bucket""",
        (fmt, frm, to),
    )
    methods = db.query(
        """SELECT p.method, COUNT(*) AS count, COALESCE(SUM(p.amount), 0) AS total
             FROM sale_payments p JOIN sales s ON s.id = p.sale_id
            WHERE s.status = 'completada' AND s.created_at BETWEEN ? AND ?
            GROUP BY p.method ORDER BY total DESC""",
        (frm, to),
    )
    sellers = db.query(
        """SELECT u.name, COUNT(*) AS count, COALESCE(SUM(s.total), 0) AS total
             FROM sales s JOIN users u ON u.id = s.user_id
            WHERE s.status = 'completada' AND s.created_at BETWEEN ? AND ?
            GROUP BY u.id ORDER BY total DESC""",
        (frm, to),
    )
    categories = db.query(
        """SELECT COALESCE(c.name, 'Sin categoria') AS category, c.color,
                  SUM(i.qty) AS qty, SUM(i.subtotal) AS total,
                  SUM(i.subtotal - i.cost * i.qty) AS profit
             FROM sale_items i JOIN sales s ON s.id = i.sale_id
             LEFT JOIN products p ON p.id = i.product_id
             LEFT JOIN categories c ON c.id = p.category_id
            WHERE s.status = 'completada' AND s.created_at BETWEEN ? AND ?
            GROUP BY category ORDER BY total DESC""",
        (frm, to),
    )
    return {
        "from": frm_d, "to": to_d, "group": group,
        "totals": _totals(frm, to),
        "series": series,
        "methods": methods,
        "sellers": sellers,
        "categories": categories,
        "top_products": _top_products(frm, to, ctx.qint("limit", 20)),
    }


@route("GET", "/api/reports/inventory", roles=("admin",))
def inventory_report(ctx):
    rows = db.query(
        """SELECT p.id, p.name, p.sku, p.unit, p.stock, p.min_stock, p.cost, p.price,
                  (p.stock * p.cost) AS cost_value, (p.stock * p.price) AS sale_value,
                  c.name AS category_name,
                  COALESCE((SELECT SUM(i.qty) FROM sale_items i JOIN sales s ON s.id = i.sale_id
                             WHERE i.product_id = p.id AND s.status = 'completada'), 0) AS sold
             FROM products p LEFT JOIN categories c ON c.id = p.category_id
            WHERE p.active = 1 ORDER BY sale_value DESC"""
    )
    return {
        "items": rows,
        "cost_value": round(sum(r["cost_value"] for r in rows), 2),
        "sale_value": round(sum(r["sale_value"] for r in rows), 2),
    }
