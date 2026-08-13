# AgroFerre POS

Sistema web de punto de venta, inventario y catálogo para un negocio de **insumos
agrícolas y ferretería**. Funciona en computador y en celular (mismo sitio, diseño
adaptable) y tiene dos módulos claramente separados:

| Módulo | Para quién | Qué hace |
|---|---|---|
| **Ferretería / Administración** | Administrador y Cajero | POS, inventario, clientes, créditos, caja, reportes, usuarios |
| **Cliente** | Clientes registrados | Catálogo, carrito, pedidos y cotizaciones, historial, estado de su fiado |

No requiere internet, ni Node, ni instalar dependencias: **solo Python 3** (ya viene
con macOS) y una base de datos **SQLite** que se crea sola.

---

## 1. Cómo iniciar

Desde la carpeta del proyecto:

```bash
python3 server.py
```

O haciendo doble clic en `iniciar.command` (macOS).

La consola muestra dos direcciones:

```
Escritorio:  http://localhost:8080
Celular:     http://192.168.x.x:8080   (misma red WiFi)
```

Para usarlo desde el celular en el mostrador, abra la segunda dirección en el
navegador del teléfono (el computador debe estar encendido y en la misma red WiFi).

Opciones útiles:

```bash
python3 server.py --port 9000     # cambiar el puerto
python3 server.py --reset         # borrar TODO y volver a los datos de ejemplo
```

## 2. Usuarios de prueba

| Rol | Correo | Contraseña | Puede hacer |
|---|---|---|---|
| Administrador | `admin@agroferre.com` | `admin123` | Todo |
| Cajero / Vendedor | `cajero@agroferre.com` | `cajero123` | Vender, cobrar, caja, clientes, abonos. **No** edita precios ni borra productos |
| Cliente | `cliente@correo.com` | `cliente123` | Catálogo, pedidos, su historial y su fiado |

Los clientes nuevos también pueden registrarse solos desde la pantalla de acceso.
Cambie estas contraseñas antes de usarlo en el negocio real (Ajustes → Mi contraseña,
y Usuarios para los demás).

## 3. Flujo de trabajo

1. **Abrir caja** con la base en efectivo (obligatorio antes de vender).
2. **Vender** en el POS: escanear o buscar el producto, ajustar cantidad, aplicar
   descuentos, elegir forma de pago (efectivo, tarjeta, transferencia, mixto o fiado)
   e imprimir el ticket. El stock se descuenta solo.
3. **Fiados**: la venta a crédito queda asociada al cliente; los abonos se registran
   desde Clientes o Créditos y se aplican a las facturas más antiguas primero.
4. **Pedidos del cliente**: llegan desde el catálogo → se aprueban → "Facturar en POS"
   carga el pedido en el carrito con su cliente y todos los productos.
5. **Cerrar caja** contando el efectivo: el sistema calcula lo esperado y la diferencia.

## 4. Qué incluye cada módulo

**Ferretería / Administración**

- **POS**: buscador por nombre/código/categoría, campo de escáner de código de barras,
  carrito con cantidad y subtotales, unidades de medida (unidad, kg, libra, litro,
  galón, bulto, metro, caja, rollo), descuento por línea y sobre el total, pagos
  mixtos, venta a crédito con abono inicial, cálculo de cambio, ticket 80 mm y
  factura A4 (imprimir o descargar).
- **Inventario**: CRUD de productos (compra, venta, stock, stock mínimo, unidad,
  proveedor, categoría, código de barras, SKU), alertas de stock bajo/agotado,
  historial de movimientos (entradas, salidas, ajustes por conteo) y proveedores.
- **Clientes**: fichas de particular o finca/empresa, historial de compras, cupo de
  crédito, saldo pendiente y abonos parciales.
- **Reportes**: ventas del día/semana/mes, ganancia estimada (venta − compra),
  productos más vendidos, ventas por categoría, por forma de pago y por vendedor,
  créditos pendientes, valor del inventario y exportación a CSV.
- **Caja**: apertura con base, ingresos y egresos de efectivo, cierre con conteo y
  diferencia, historial de turnos.
- **Usuarios**: administradores, cajeros y cuentas de cliente con permisos por rol.

**Cliente**

- Catálogo por categorías con búsqueda, filtros de precio y disponibilidad.
- Carrito para armar un **pedido** (recoger en tienda) o pedir una **cotización**.
- Historial de pedidos con su estado (pendiente → aprobado → listo → entregado).
- Historial de compras hechas en la tienda.
- Estado de su crédito: cupo, saldo pendiente, facturas y abonos.
- Perfil con datos de contacto y finca/negocio asociado.

## 5. Estructura del proyecto

```
agroferre-pos/
├── server.py              Servidor HTTP + archivos estáticos (solo stdlib)
├── iniciar.command        Arranque con doble clic (macOS)
├── app/
│   ├── db.py              Esquema SQLite y datos de ejemplo
│   ├── auth.py            Contraseñas (PBKDF2), sesiones y roles
│   ├── router.py          Enrutador de la API
│   ├── routes_auth.py     Login, registro, contraseña
│   ├── routes_inventory.py Productos, categorías, proveedores, movimientos, catálogo
│   ├── routes_sales.py    Ventas, abonos y caja
│   ├── routes_customers.py Clientes, pedidos y área del cliente
│   ├── routes_reports.py  Dashboard y reportes
│   └── routes_admin.py    Usuarios y configuración
├── web/
│   ├── index.html
│   ├── css/app.css        Tema completo (verde agro + naranja ferretería + tierra)
│   └── js/
│       ├── app.js         Navegación, roles, menú lateral e inferior
│       ├── api.js         Cliente HTTP y sesión
│       ├── ui.js          Formato, modales, formularios, avisos
│       ├── ticket.js      Ticket y factura imprimibles
│       ├── cart.js        Carrito del cliente
│       ├── pickers.js     Selector de clientes
│       └── views/         Una vista por sección
└── data/pos.db            Base de datos (se crea automáticamente)
```

## 6. Base de datos

Tablas: `users`, `sessions`, `customers`, `categories`, `suppliers`, `products`,
`inventory_moves`, `sales`, `sale_items`, `sale_payments`, `credit_payments`,
`cash_sessions`, `cash_movements`, `orders`, `order_items`, `settings`.

Todo vive en **`data/pos.db`**. Para respaldar el negocio basta con copiar ese
archivo (hágalo con el servidor detenido, y copie también `pos.db-wal` si existe).

## 7. Notas de seguridad

- Las contraseñas se guardan con PBKDF2-SHA256 (120.000 iteraciones), nunca en texto plano.
- Las sesiones usan tokens aleatorios con vencimiento de 14 días.
- Cada endpoint valida el rol: el cajero no puede cambiar precios, borrar productos,
  ver reportes ni administrar usuarios.
- El servidor está pensado para la red local del negocio. Si algún día lo expone a
  internet, póngalo detrás de un proxy con HTTPS.
