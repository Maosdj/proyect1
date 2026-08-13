"""Capa de base de datos: conexion, esquema y datos iniciales."""

import os
import sqlite3
import threading
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "pos.db")

_local = threading.local()
write_lock = threading.Lock()


def now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def today():
    return datetime.now().strftime("%Y-%m-%d")


def get_conn():
    """Una conexion por hilo (el servidor es multi-hilo)."""
    conn = getattr(_local, "conn", None)
    if conn is None:
        os.makedirs(DATA_DIR, exist_ok=True)
        conn = sqlite3.connect(DB_PATH, timeout=15)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        _local.conn = conn
    return conn


def query(sql, args=()):
    return [dict(r) for r in get_conn().execute(sql, args).fetchall()]


def one(sql, args=()):
    row = get_conn().execute(sql, args).fetchone()
    return dict(row) if row else None


def execute(sql, args=()):
    conn = get_conn()
    with write_lock:
        cur = conn.execute(sql, args)
        conn.commit()
    return cur


def insert(table, data):
    cols = ", ".join(data.keys())
    marks = ", ".join("?" for _ in data)
    cur = execute(
        "INSERT INTO %s (%s) VALUES (%s)" % (table, cols, marks), tuple(data.values())
    )
    return cur.lastrowid


def update(table, row_id, data):
    if not data:
        return
    sets = ", ".join("%s = ?" % k for k in data)
    execute(
        "UPDATE %s SET %s WHERE id = ?" % (table, sets), tuple(data.values()) + (row_id,)
    )


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT DEFAULT '',
    role TEXT NOT NULL,               -- admin | cajero | cliente
    pass_hash TEXT NOT NULL,
    customer_id INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    doc TEXT DEFAULT '',              -- cedula / NIT
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    address TEXT DEFAULT '',
    type TEXT NOT NULL DEFAULT 'particular',   -- particular | finca
    farm_name TEXT DEFAULT '',
    credit_limit REAL NOT NULL DEFAULT 0,
    notes TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    icon TEXT DEFAULT '',
    color TEXT DEFAULT '#8a6d3b',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    address TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT DEFAULT '',
    barcode TEXT DEFAULT '',
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    category_id INTEGER,
    supplier_id INTEGER,
    cost REAL NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0,
    stock REAL NOT NULL DEFAULT 0,
    min_stock REAL NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'unidad',
    image TEXT DEFAULT '',
    visible INTEGER NOT NULL DEFAULT 1,   -- visible en catalogo del cliente
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_moves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    type TEXT NOT NULL,               -- entrada | salida | ajuste
    qty REAL NOT NULL,
    stock_before REAL NOT NULL,
    stock_after REAL NOT NULL,
    reason TEXT DEFAULT '',
    ref_type TEXT DEFAULT '',         -- venta | compra | manual | anulacion
    ref_id INTEGER,
    user_id INTEGER,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folio TEXT NOT NULL,
    customer_id INTEGER,
    user_id INTEGER NOT NULL,
    cash_session_id INTEGER,
    subtotal REAL NOT NULL DEFAULT 0,
    discount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    cost_total REAL NOT NULL DEFAULT 0,
    paid REAL NOT NULL DEFAULT 0,
    balance REAL NOT NULL DEFAULT 0,
    payment_type TEXT NOT NULL DEFAULT 'efectivo',
    is_credit INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completada',   -- completada | anulada
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    product_id INTEGER,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'unidad',
    qty REAL NOT NULL,
    price REAL NOT NULL,
    cost REAL NOT NULL DEFAULT 0,
    discount REAL NOT NULL DEFAULT 0,
    subtotal REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS sale_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    method TEXT NOT NULL,             -- efectivo | tarjeta | transferencia | credito
    amount REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    sale_id INTEGER,
    amount REAL NOT NULL,
    method TEXT NOT NULL DEFAULT 'efectivo',
    user_id INTEGER,
    cash_session_id INTEGER,
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cash_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opened_by INTEGER NOT NULL,
    opening_amount REAL NOT NULL DEFAULT 0,
    opened_at TEXT NOT NULL,
    closed_by INTEGER,
    closed_at TEXT,
    counted_amount REAL,
    expected_amount REAL,
    difference REAL,
    status TEXT NOT NULL DEFAULT 'abierta',    -- abierta | cerrada
    note TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS cash_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    type TEXT NOT NULL,               -- ingreso | egreso
    amount REAL NOT NULL,
    concept TEXT DEFAULT '',
    user_id INTEGER,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folio TEXT NOT NULL,
    customer_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'pedido',       -- pedido | cotizacion
    status TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente | aprobado | listo | entregado | cancelado
    total REAL NOT NULL DEFAULT 0,
    note TEXT DEFAULT '',
    sale_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'unidad',
    qty REAL NOT NULL,
    price REAL NOT NULL,
    subtotal REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_moves_product ON inventory_moves(product_id);
"""

DEFAULT_SETTINGS = {
    "business_name": "AgroFerre - Insumos Agricolas y Ferreteria",
    "business_short": "AgroFerre",
    "address": "Cra 5 # 12-34, Plaza de Mercado",
    "phone": "312 555 4433",
    "nit": "900.123.456-7",
    "currency": "$",
    "ticket_footer": "Gracias por su compra. Cambios con factura dentro de 8 dias.",
    "low_stock_alert": "1",
}

CATEGORIES = [
    ("Agroquimicos", "\U0001F9EA", "#2f6b3f"),
    ("Fertilizantes", "\U0001F33E", "#5b8c2a"),
    ("Semillas", "\U0001F331", "#7aa832"),
    ("Herramientas", "\U0001F528", "#c2410c"),
    ("Tornilleria", "\U0001F529", "#6b7280"),
    ("Electrico", "\U0001F50C", "#b45309"),
    ("Plomeria", "\U0001F6BF", "#0e7490"),
    ("Pintura", "\U0001F3A8", "#9333ea"),
    ("Cabuyeria", "\U0001FAA2", "#8b5e34"),
    ("Otros", "\U0001F4E6", "#57534e"),
]

SUPPLIERS = [
    ("Agroinsumos del Valle S.A.S.", "Carlos Mejia", "310 442 1188", "ventas@agroinsumosvalle.co", "Zona Industrial Bod. 12"),
    ("Ferredistribuciones Andina", "Marta Ruiz", "315 890 2244", "pedidos@ferrandina.com", "Calle 44 # 8-90"),
    ("Semillas y Abonos El Campo", "Jorge Patino", "301 776 5512", "elcampo@semillas.co", "Km 3 via al norte"),
    ("Electro Suministros JP", "Paola Gomez", "320 118 4477", "jp@electrosum.co", "Av. Sexta # 21-15"),
]

# (nombre, categoria, proveedor, unidad, costo, precio, stock, min, sku, barcode, emoji, desc)
PRODUCTS = [
    ("Herbicida Glifosato 1 L", "Agroquimicos", 1, "litro", 28000, 38500, 45, 10, "AGQ-001", "7701001000017", "\U0001F9F4", "Herbicida sistemico de amplio espectro"),
    ("Insecticida Clorpirifos 1 L", "Agroquimicos", 1, "litro", 34000, 46000, 22, 8, "AGQ-002", "7701001000024", "\U0001FAB0", "Control de plagas en cultivos"),
    ("Fungicida Mancozeb 1 kg", "Agroquimicos", 1, "kg", 19500, 27000, 30, 10, "AGQ-003", "7701001000031", "\U0001F344", "Fungicida preventivo de contacto"),
    ("Herbicida Paraquat 1 L", "Agroquimicos", 1, "litro", 31000, 42000, 6, 8, "AGQ-004", "7701001000048", "\U0001F9F4", "Herbicida de contacto no selectivo"),
    ("Coadyuvante adherente 250 ml", "Agroquimicos", 1, "unidad", 7800, 12000, 40, 12, "AGQ-005", "7701001000055", "\U0001F4A7", "Mejora adherencia de aspersiones"),
    ("Abono Triple 15 x 50 kg", "Fertilizantes", 3, "bulto", 145000, 178000, 28, 6, "FER-001", "7702002000014", "\U0001F33E", "Fertilizante compuesto NPK 15-15-15"),
    ("Urea 46% x 50 kg", "Fertilizantes", 3, "bulto", 132000, 162000, 18, 6, "FER-002", "7702002000021", "\U0001F33E", "Fuente nitrogenada de alta concentracion"),
    ("DAP 18-46-0 x 50 kg", "Fertilizantes", 3, "bulto", 168000, 205000, 9, 5, "FER-003", "7702002000038", "\U0001F33E", "Fosforo y nitrogeno para siembra"),
    ("Fertilizante foliar 1 L", "Fertilizantes", 3, "litro", 22000, 31000, 35, 10, "FER-004", "7702002000045", "\U0001F33F", "Nutricion foliar con microelementos"),
    ("Cal dolomita x 25 kg", "Fertilizantes", 3, "bulto", 21000, 29000, 40, 10, "FER-005", "7702002000052", "\U000026F0", "Corrector de acidez del suelo"),
    ("Semilla de maiz hibrido 1 kg", "Semillas", 3, "kg", 26000, 35000, 25, 8, "SEM-001", "7703003000013", "\U0001F33D", "Alto rendimiento, ciclo corto"),
    ("Semilla de frijol 1 kg", "Semillas", 3, "kg", 14000, 19500, 30, 10, "SEM-002", "7703003000020", "\U0001FAD8", "Variedad arbustiva certificada"),
    ("Semilla pasto Brachiaria 1 kg", "Semillas", 3, "kg", 31000, 42000, 14, 5, "SEM-003", "7703003000037", "\U0001F33E", "Pastura resistente a sequia"),
    ("Semilla de tomate sobre 10 g", "Semillas", 3, "unidad", 9000, 14500, 50, 15, "SEM-004", "7703003000044", "\U0001F345", "Chonto larga vida"),
    ("Machete 22 pulgadas", "Herramientas", 2, "unidad", 18000, 27000, 24, 8, "HER-001", "7704004000012", "\U0001F52A", "Hoja de acero templado con funda"),
    ("Pala cuadrada mango madera", "Herramientas", 2, "unidad", 32000, 45000, 12, 5, "HER-002", "7704004000029", "\U0001F6E0", "Uso agricola y construccion"),
    ("Azadon 3 lb con cabo", "Herramientas", 2, "unidad", 29000, 41000, 15, 5, "HER-003", "7704004000036", "\U000026CF", "Forjado, cabo de madera 1.2 m"),
    ("Bomba fumigadora 20 L", "Herramientas", 1, "unidad", 118000, 155000, 7, 3, "HER-004", "7704004000043", "\U0001F392", "De espalda, palanca reforzada"),
    ("Carretilla llanta neumatica", "Herramientas", 2, "unidad", 165000, 215000, 4, 2, "HER-005", "7704004000050", "\U0001F6D2", "Balde metalico 65 L"),
    ("Martillo una 16 oz", "Herramientas", 2, "unidad", 16500, 24000, 20, 6, "HER-006", "7704004000067", "\U0001F528", "Mango de fibra antideslizante"),
    ("Rastrillo 14 dientes", "Herramientas", 2, "unidad", 21000, 30000, 10, 4, "HER-007", "7704004000074", "\U0001F9F9", "Acero con cabo de madera"),
    ("Tornillo autoperforante 1 pulg", "Tornilleria", 2, "unidad", 90, 180, 1800, 300, "TOR-001", "7705005000011", "\U0001F529", "Punta broca para lamina"),
    ("Puntilla 2.5 pulgadas", "Tornilleria", 2, "kg", 6200, 9500, 65, 15, "TOR-002", "7705005000028", "\U0001F4CC", "Puntilla con cabeza, venta por kilo"),
    ("Tuerca hexagonal 3/8", "Tornilleria", 2, "unidad", 250, 500, 900, 200, "TOR-003", "7705005000035", "\U0001F529", "Acero galvanizado"),
    ("Arandela plana 1/4", "Tornilleria", 2, "unidad", 120, 300, 1200, 250, "TOR-004", "7705005000042", "\U000026AA", "Galvanizada"),
    ("Chazo plastico #8 con tornillo", "Tornilleria", 2, "unidad", 180, 400, 700, 150, "TOR-005", "7705005000059", "\U0001F529", "Para muro y concreto"),
    ("Cable encauchetado 2x14", "Electrico", 4, "metro", 4200, 6500, 320, 60, "ELE-001", "7706006000010", "\U0001F50C", "Cobre, uso exterior"),
    ("Bombillo LED 9W luz fria", "Electrico", 4, "unidad", 4800, 8500, 80, 20, "ELE-002", "7706006000027", "\U0001F4A1", "Rosca E27, 900 lumenes"),
    ("Toma doble con polo a tierra", "Electrico", 4, "unidad", 6500, 11000, 45, 12, "ELE-003", "7706006000034", "\U0001F50C", "Incluye tapa"),
    ("Interruptor sencillo", "Electrico", 4, "unidad", 4200, 7500, 50, 12, "ELE-004", "7706006000041", "\U0001F50B", "Blanco, 10A"),
    ("Breaker enchufable 20A", "Electrico", 4, "unidad", 12000, 19000, 18, 6, "ELE-005", "7706006000058", "\U000026A1", "Proteccion termomagnetica"),
    ("Cinta aislante 18 m", "Electrico", 4, "unidad", 3200, 6000, 60, 15, "ELE-006", "7706006000065", "\U0001F5DC", "Negra, uso general"),
    ("Tubo PVC 1/2 pulg x 6 m", "Plomeria", 2, "unidad", 14000, 21000, 35, 10, "PLO-001", "7707007000019", "\U0001F6BF", "Presion, union soldada"),
    ("Codo PVC 1/2 pulg 90 grados", "Plomeria", 2, "unidad", 900, 1800, 200, 40, "PLO-002", "7707007000026", "\U0001F527", "Presion"),
    ("Llave de paso 1/2 pulg", "Plomeria", 2, "unidad", 11000, 17500, 22, 8, "PLO-003", "7707007000033", "\U0001F6B0", "Bronce"),
    ("Cinta teflon 1/2 pulg", "Plomeria", 2, "unidad", 900, 2000, 150, 30, "PLO-004", "7707007000040", "\U0001F9FB", "Rollo 10 m"),
    ("Manguera poliducto 1/2 pulg", "Plomeria", 2, "metro", 1400, 2500, 400, 80, "PLO-005", "7707007000057", "\U0001F30A", "Negra, alta presion"),
    ("Registro/valvula 3/4 pulg", "Plomeria", 2, "unidad", 15000, 23000, 14, 5, "PLO-006", "7707007000064", "\U0001F6B0", "Bronce reforzado"),
    ("Pintura vinilo Tipo 1 galon", "Pintura", 2, "galon", 52000, 74000, 16, 5, "PIN-001", "7708008000018", "\U0001FAA3", "Blanco, rendimiento 40 m2"),
    ("Anticorrosivo rojo 1/4 galon", "Pintura", 2, "unidad", 18000, 27000, 20, 6, "PIN-002", "7708008000025", "\U0001F3A8", "Base para metales"),
    ("Brocha 3 pulgadas", "Pintura", 2, "unidad", 5500, 9500, 30, 10, "PIN-003", "7708008000032", "\U0001F58C", "Cerda natural"),
    ("Rodillo 9 pulg con mango", "Pintura", 2, "unidad", 9000, 15000, 18, 6, "PIN-004", "7708008000049", "\U0001F3A8", "Felpa lisa"),
    ("Thinner 1 L", "Pintura", 2, "litro", 8500, 13500, 25, 8, "PIN-005", "7708008000056", "\U0001F9F4", "Corriente"),
    ("Lazo polipropileno 1/2 pulg", "Cabuyeria", 2, "metro", 1600, 2800, 250, 50, "CAB-001", "7709009000017", "\U0001FAA2", "Alta resistencia"),
    ("Cabuya de fique rollo 1 kg", "Cabuyeria", 3, "kg", 12000, 18000, 22, 8, "CAB-002", "7709009000024", "\U0001F9F6", "Fibra natural"),
    ("Cuerda nylon 6 mm", "Cabuyeria", 2, "metro", 900, 1800, 300, 60, "CAB-003", "7709009000031", "\U0001FAA2", "Trenzada"),
    ("Malla gallinero 1 m alto", "Cabuyeria", 2, "metro", 4500, 7000, 120, 25, "CAB-004", "7709009000048", "\U0001F578", "Hexagonal calibre 22"),
    ("Alambre de puas rollo 400 m", "Cabuyeria", 3, "unidad", 145000, 189000, 5, 3, "CAB-005", "7709009000055", "\U0001F517", "Calibre 14, galvanizado"),
    ("Guantes de carnaza", "Otros", 2, "unidad", 6500, 11000, 40, 12, "OTR-001", "7710010000016", "\U0001F9E4", "Proteccion para labores agricolas"),
    ("Botas de caucho talla 40", "Otros", 2, "unidad", 38000, 52000, 12, 4, "OTR-002", "7710010000023", "\U0001F97E", "Cana alta, suela antideslizante"),
    ("Costal de fique", "Otros", 3, "unidad", 2800, 5000, 90, 20, "OTR-003", "7710010000030", "\U0001F45C", "Capacidad 50 kg"),
    ("Silicona transparente", "Otros", 2, "unidad", 7500, 12500, 26, 8, "OTR-004", "7710010000047", "\U0001F9F4", "Sellante multiuso"),
]

CUSTOMERS = [
    ("Finca La Esperanza", "900456789-1", "311 224 5566", "esperanza@finca.co", "Vereda El Roble Km 8", "finca", "La Esperanza", 3000000),
    ("Pedro Antonio Ramirez", "16789456", "300 445 7788", "", "Calle 9 # 4-21", "particular", "", 500000),
    ("Constructora Los Cedros", "901223344-5", "318 990 1122", "compras@loscedros.co", "Av. Principal # 30-12", "finca", "Obra Los Cedros", 5000000),
    ("Maria Fernanda Lopez", "52887744", "301 556 8899", "mafe@correo.com", "Barrio Centro Mz 4 Casa 7", "particular", "", 0),
    ("Hacienda El Porvenir", "800112233-4", "313 445 6677", "porvenir@agro.co", "Km 15 via La Union", "finca", "El Porvenir", 4000000),
]


def init_db(seed=True):
    conn = get_conn()
    conn.executescript(SCHEMA)
    conn.commit()
    if seed and not one("SELECT id FROM users LIMIT 1"):
        _seed()


def _seed():
    from . import auth

    ts = now()
    for key, value in DEFAULT_SETTINGS.items():
        execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value))

    for name, icon, color in CATEGORIES:
        insert("categories", {"name": name, "icon": icon, "color": color, "created_at": ts})

    for name, contact, phone, email, address in SUPPLIERS:
        insert("suppliers", {
            "name": name, "contact": contact, "phone": phone, "email": email,
            "address": address, "created_at": ts,
        })

    cat_ids = {r["name"]: r["id"] for r in query("SELECT id, name FROM categories")}
    for (name, cat, sup, unit, cost, price, stock, mn, sku, barcode, emoji, desc) in PRODUCTS:
        pid = insert("products", {
            "sku": sku, "barcode": barcode, "name": name, "description": desc,
            "category_id": cat_ids[cat], "supplier_id": sup, "cost": cost, "price": price,
            "stock": stock, "min_stock": mn, "unit": unit, "image": emoji,
            "visible": 1, "active": 1, "created_at": ts,
        })
        insert("inventory_moves", {
            "product_id": pid, "type": "entrada", "qty": stock, "stock_before": 0,
            "stock_after": stock, "reason": "Inventario inicial", "ref_type": "manual",
            "user_id": None, "created_at": ts,
        })

    for name, doc, phone, email, address, ctype, farm, limit in CUSTOMERS:
        insert("customers", {
            "name": name, "doc": doc, "phone": phone, "email": email, "address": address,
            "type": ctype, "farm_name": farm, "credit_limit": limit, "created_at": ts,
        })

    insert("users", {
        "name": "Administrador", "email": "admin@agroferre.com", "phone": "312 555 4433",
        "role": "admin", "pass_hash": auth.hash_password("admin123"),
        "customer_id": None, "active": 1, "created_at": ts,
    })
    insert("users", {
        "name": "Luis Cajero", "email": "cajero@agroferre.com", "phone": "300 111 2233",
        "role": "cajero", "pass_hash": auth.hash_password("cajero123"),
        "customer_id": None, "active": 1, "created_at": ts,
    })
    insert("users", {
        "name": "Finca La Esperanza", "email": "cliente@correo.com", "phone": "311 224 5566",
        "role": "cliente", "pass_hash": auth.hash_password("cliente123"),
        "customer_id": 1, "active": 1, "created_at": ts,
    })
