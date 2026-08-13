// Punto de venta: busqueda, escaner, carrito, descuentos, pagos y ticket.

import { api, state } from '../api.js';
import {
  esc, money, qty as fmtQty, notify, openModal, confirmDialog, debounce, setActions, emptyState,
} from '../ui.js';
import { pickCustomer } from '../pickers.js';
import { printTicket, downloadTicket } from '../ticket.js';
import { refreshBadges } from '../app.js';

const METHOD_LABELS = {
  efectivo: '💵 Efectivo', tarjeta: '💳 Tarjeta',
  transferencia: '📱 Transferencia', mixto: '🔀 Mixto', credito: '📒 Fiado',
};

export async function render(view, query) {
  const sale = {
    lines: [],
    discount: 0,
    customer: null,
    method: 'efectivo',
    received: 0,
    mixed: { efectivo: 0, tarjeta: 0, transferencia: 0 },
    creditPaid: 0,
    note: '',
    orderId: null,
  };
  let products = [];
  let activeCategory = 0;
  let cashOpen = false;

  view.innerHTML = `
    <div id="cash-warn"></div>
    <div class="pos">
      <div>
        <div class="card card-flat" style="padding:13px">
          <div class="scan-bar">
            <div class="search-wrap">
              <input class="input input-lg" id="scan" placeholder="Escanear codigo de barras..."
                     autocomplete="off" inputmode="text">
            </div>
            <button class="btn btn-soft" id="btn-clear-search" title="Limpiar">✕</button>
          </div>
          <div class="search-wrap" style="margin-bottom:10px">
            <input class="input" id="search" placeholder="Buscar producto por nombre, codigo o categoria"
                   autocomplete="off">
          </div>
          <div class="chips" id="cats"></div>
        </div>
        <div id="grid" class="prod-grid"></div>
      </div>

      <div class="pos-cart">
        <div class="card">
          <div class="card-head">
            <h2>🧾 Venta actual</h2>
            <span class="spacer"></span>
            <button class="btn btn-sm btn-soft" id="btn-clear">Vaciar</button>
          </div>
          <button class="btn btn-soft btn-block" id="btn-customer" style="justify-content:flex-start">
            👤 Consumidor final
          </button>
          <div class="cart-items" id="cart"></div>
          <div class="totals" id="totals"></div>
          <div id="pay-zone"></div>
        </div>
      </div>
    </div>
    <div class="pos-fab" id="fab"></div>`;

  const $ = (id) => view.querySelector('#' + id);
  const scanInput = $('scan');
  const searchInput = $('search');

  /* ------------------------------------------------------------ caja */
  async function checkCash() {
    try {
      const res = await api.get('/api/cash/current');
      cashOpen = !!res.session;
    } catch (e) { cashOpen = false; }
    $('cash-warn').innerHTML = cashOpen ? '' : `
      <div class="card" style="border-left:4px solid var(--ambar);display:flex;gap:12px;
           align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <strong>⚠️ La caja esta cerrada</strong>
          <p class="small muted">Debe abrir la caja antes de registrar ventas.</p>
        </div>
        <button class="btn btn-primary" id="btn-open-cash">Abrir caja</button>
      </div>`;
    const btn = $('btn-open-cash');
    if (btn) btn.addEventListener('click', openCashModal);
  }

  function openCashModal() {
    openModal({
      title: 'Apertura de caja',
      body: `<div class="field"><label>Base inicial en efectivo</label>
        <input class="input input-lg" type="number" id="opening" value="0" min="0" step="any"></div>
        <p class="small muted">Registre el dinero con el que inicia el turno.</p>`,
      footer: `<button class="btn btn-soft" data-close>Cancelar</button>
               <button class="btn btn-primary" data-ok>Abrir caja</button>`,
      onMount: (root, close) => {
        root.querySelector('[data-ok]').addEventListener('click', async () => {
          try {
            await api.post('/api/cash/open', { opening_amount: Number(root.querySelector('#opening').value || 0) });
            notify.ok('Caja abierta');
            close();
            checkCash();
          } catch (e) { notify.error(e.message); }
        });
      },
    });
  }

  /* -------------------------------------------------------- productos */
  function drawCategories() {
    $('cats').innerHTML = `<button class="chip ${activeCategory === 0 ? 'active' : ''}" data-cat="0">Todo</button>` +
      state.categories.map(c => `<button class="chip ${activeCategory === c.id ? 'active' : ''}"
        data-cat="${c.id}">${c.icon || ''} ${esc(c.name)}</button>`).join('');
    $('cats').querySelectorAll('[data-cat]').forEach(b => {
      b.addEventListener('click', () => {
        activeCategory = Number(b.dataset.cat);
        drawCategories();
        loadProducts();
      });
    });
  }

  async function loadProducts() {
    $('grid').innerHTML = '<p class="muted small">Buscando productos...</p>';
    try {
      const res = await api.get('/api/products', {
        q: searchInput.value.trim(), category: activeCategory || '', limit: 80,
      });
      products = res.items;
      drawGrid();
    } catch (e) {
      $('grid').innerHTML = `<p class="danger-text">${esc(e.message)}</p>`;
    }
  }

  function drawGrid() {
    if (!products.length) {
      $('grid').innerHTML = emptyState('🔍', 'Sin productos', 'Pruebe con otra busqueda o categoria');
      return;
    }
    $('grid').innerHTML = products.map(p => `
      <button class="prod-card ${p.stock <= 0 ? 'out' : ''}" data-p="${p.id}">
        <span class="emoji">${p.image || '📦'}</span>
        <span class="cat-tag">${esc(p.category_name || '')}</span>
        <span class="pname">${esc(p.name)}</span>
        <span class="pprice">${money(p.price)}</span>
        <span class="pstock">${p.stock <= 0 ? '⛔ Agotado' :
          `${fmtQty(p.stock)} ${esc(p.unit)}${p.min_stock && p.stock <= p.min_stock ? ' ⚠️' : ''}`}</span>
      </button>`).join('');
    $('grid').querySelectorAll('[data-p]').forEach(b => {
      b.addEventListener('click', () => addProduct(products.find(p => p.id === Number(b.dataset.p))));
    });
  }

  /* --------------------------------------------------------- carrito */
  function addProduct(product, amount = 1) {
    if (!product) return;
    if (product.stock <= 0) { notify.error(product.name + ' esta agotado'); return; }
    const line = sale.lines.find(l => l.product_id === product.id);
    const nextQty = (line ? line.qty : 0) + amount;
    if (nextQty > product.stock) {
      notify.error(`Solo hay ${fmtQty(product.stock)} ${product.unit} de ${product.name}`);
      return;
    }
    if (line) line.qty = Math.round(nextQty * 1000) / 1000;
    else sale.lines.push({
      product_id: product.id, name: product.name, unit: product.unit, price: product.price,
      stock: product.stock, qty: amount, discount: 0, image: product.image,
    });
    drawCart();
  }

  function lineTotal(l) {
    return Math.max(0, Math.round((l.qty * l.price - l.discount) * 100) / 100);
  }
  function subtotal() {
    return Math.round(sale.lines.reduce((s, l) => s + lineTotal(l), 0) * 100) / 100;
  }
  function total() {
    return Math.max(0, Math.round((subtotal() - sale.discount) * 100) / 100);
  }

  function drawCart() {
    const cart = $('cart');
    if (!sale.lines.length) {
      cart.innerHTML = emptyState('🛒', 'Carrito vacio', 'Escanee o toque un producto');
    } else {
      cart.innerHTML = sale.lines.map((l, idx) => `
        <div class="cart-line">
          <div class="cl-name">${l.image || '📦'} ${esc(l.name)}</div>
          <div class="cl-sub">${money(lineTotal(l))}</div>
          <div class="cl-meta">
            <div class="qty-box">
              <button data-dec="${idx}">−</button>
              <input type="text" inputmode="decimal" value="${fmtQty(l.qty)}" data-qty="${idx}">
              <button data-inc="${idx}">+</button>
            </div>
            <span class="small muted nowrap">${money(l.price)}/${esc(l.unit)}</span>
            <span class="spacer"></span>
            <button class="btn btn-sm btn-soft" data-disc="${idx}"
              title="Descuento en esta linea">${l.discount ? '−' + money(l.discount) : '%'}</button>
            <button class="btn btn-sm btn-soft" data-del="${idx}">🗑️</button>
          </div>
        </div>`).join('');

      cart.querySelectorAll('[data-inc]').forEach(b => b.addEventListener('click', () => {
        const l = sale.lines[Number(b.dataset.inc)];
        if (l.qty + 1 > l.stock) return notify.error('No hay mas existencias');
        l.qty = Math.round((l.qty + 1) * 1000) / 1000; drawCart();
      }));
      cart.querySelectorAll('[data-dec]').forEach(b => b.addEventListener('click', () => {
        const i = Number(b.dataset.dec);
        const l = sale.lines[i];
        l.qty = Math.round((l.qty - 1) * 1000) / 1000;
        if (l.qty <= 0) sale.lines.splice(i, 1);
        drawCart();
      }));
      cart.querySelectorAll('[data-qty]').forEach(inp => {
        const commit = () => {
          const i = Number(inp.dataset.qty);
          const l = sale.lines[i];
          const v = Number(String(inp.value).replace(',', '.'));
          if (!v || v <= 0) { sale.lines.splice(i, 1); drawCart(); return; }
          if (v > l.stock) { notify.error(`Solo hay ${fmtQty(l.stock)} ${l.unit}`); inp.value = fmtQty(l.qty); return; }
          l.qty = v; drawCart();
        };
        inp.addEventListener('change', commit);
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') { commit(); scanInput.focus(); } });
      });
      cart.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
        sale.lines.splice(Number(b.dataset.del), 1); drawCart();
      }));
      cart.querySelectorAll('[data-disc]').forEach(b => b.addEventListener('click', () => {
        lineDiscountModal(Number(b.dataset.disc));
      }));
    }
    drawTotals();
    drawPay();
    drawFab();
  }

  function lineDiscountModal(idx) {
    const l = sale.lines[idx];
    const base = l.qty * l.price;
    openModal({
      title: 'Descuento en ' + l.name,
      body: `
        <p class="small muted">Valor de la linea: <b>${money(base)}</b></p>
        <div class="form-grid">
          <div class="field"><label>Descuento en dinero</label>
            <input class="input input-lg" type="number" id="d-amount" value="${l.discount || 0}" min="0" step="any"></div>
          <div class="field"><label>O en porcentaje</label>
            <input class="input input-lg" type="number" id="d-pct" placeholder="%" min="0" max="100" step="any"></div>
        </div>`,
      footer: `<button class="btn btn-soft" data-close>Cancelar</button>
               <button class="btn btn-primary" data-ok>Aplicar</button>`,
      onMount: (root, close) => {
        const amount = root.querySelector('#d-amount');
        const pct = root.querySelector('#d-pct');
        pct.addEventListener('input', () => {
          const v = Number(pct.value || 0);
          amount.value = Math.round(base * v) / 100;
        });
        root.querySelector('[data-ok]').addEventListener('click', () => {
          const v = Number(amount.value || 0);
          if (v < 0 || v > base) return notify.error('Descuento invalido');
          l.discount = Math.round(v * 100) / 100;
          close(); drawCart();
        });
      },
    });
  }

  function globalDiscountModal() {
    const base = subtotal();
    openModal({
      title: 'Descuento sobre el total',
      body: `<p class="small muted">Subtotal de la venta: <b>${money(base)}</b></p>
        <div class="form-grid">
          <div class="field"><label>Descuento en dinero</label>
            <input class="input input-lg" type="number" id="g-amount" value="${sale.discount || 0}" min="0" step="any"></div>
          <div class="field"><label>O en porcentaje</label>
            <input class="input input-lg" type="number" id="g-pct" placeholder="%" min="0" max="100" step="any"></div>
        </div>`,
      footer: `<button class="btn btn-soft" data-close>Cancelar</button>
               <button class="btn btn-primary" data-ok>Aplicar</button>`,
      onMount: (root, close) => {
        const amount = root.querySelector('#g-amount');
        root.querySelector('#g-pct').addEventListener('input', (e) => {
          amount.value = Math.round(base * Number(e.target.value || 0)) / 100;
        });
        root.querySelector('[data-ok]').addEventListener('click', () => {
          const v = Number(amount.value || 0);
          if (v < 0 || v > base) return notify.error('El descuento no puede superar el subtotal');
          sale.discount = Math.round(v * 100) / 100;
          close(); drawCart();
        });
      },
    });
  }

  function drawTotals() {
    const t = total();
    $('totals').innerHTML = `
      <div class="line"><span>Subtotal</span><span class="mono">${money(subtotal())}</span></div>
      <div class="line">
        <button class="btn btn-sm btn-soft" id="btn-gdisc">Descuento general</button>
        <span class="mono">${sale.discount ? '− ' + money(sale.discount) : money(0)}</span>
      </div>
      <div class="line grand"><span>TOTAL</span><span class="mono">${money(t)}</span></div>`;
    $('btn-gdisc').addEventListener('click', globalDiscountModal);
  }

  function drawPay() {
    const t = total();
    const zone = $('pay-zone');
    if (!sale.lines.length) { zone.innerHTML = ''; return; }

    const methods = ['efectivo', 'tarjeta', 'transferencia', 'mixto', 'credito'];
    let extra = '';
    if (sale.method === 'efectivo') {
      const change = Math.round((sale.received - t) * 100) / 100;
      extra = `
        <div class="field" style="margin-top:10px"><label>Efectivo recibido</label>
          <input class="input input-lg mono" type="number" id="received" step="any" min="0"
                 value="${sale.received || ''}" placeholder="${t}"></div>
        <div class="row row-tight" style="margin-bottom:10px">
          ${[t, 10000, 20000, 50000, 100000].map(v =>
            `<button class="btn btn-sm btn-soft" data-cash="${v}">${v === t ? 'Exacto' : money(v)}</button>`).join('')}
        </div>
        <div class="line" style="display:flex;justify-content:space-between;font-weight:700">
          <span>Cambio</span>
          <span class="mono ${change < 0 ? 'danger-text' : 'ok-text'}">${money(Math.max(change, 0))}</span>
        </div>`;
    } else if (sale.method === 'mixto') {
      const sum = sale.mixed.efectivo + sale.mixed.tarjeta + sale.mixed.transferencia;
      extra = `<div class="form-grid" style="margin-top:10px">
          ${['efectivo', 'tarjeta', 'transferencia'].map(m => `
            <div class="field"><label>${METHOD_LABELS[m]}</label>
              <input class="input mono" type="number" min="0" step="any" data-mix="${m}"
                     value="${sale.mixed[m] || ''}"></div>`).join('')}
        </div>
        <div class="line" style="display:flex;justify-content:space-between">
          <span>Suma de pagos</span>
          <span class="mono ${sum + 0.01 < t ? 'danger-text' : 'ok-text'}">${money(sum)}</span>
        </div>`;
    } else if (sale.method === 'credito') {
      extra = `
        <div class="card card-flat" style="background:var(--ambar-100);border-color:transparent;
             padding:10px;margin:10px 0">
          <strong class="small">📒 Venta a credito (fiado)</strong>
          <p class="small">Requiere un cliente registrado. El saldo queda pendiente en su cuenta.</p>
        </div>
        <div class="field"><label>Abono inicial (opcional)</label>
          <input class="input mono" type="number" id="credit-paid" min="0" step="any"
                 value="${sale.creditPaid || ''}" placeholder="0"></div>`;
    }

    zone.innerHTML = `
      <div style="margin-top:12px">
        <label class="small strong">Forma de pago</label>
        <div class="pay-methods" style="margin:7px 0 4px">
          ${methods.map(m => `<button class="pay-btn ${sale.method === m ? 'active' : ''}"
            data-method="${m}">${METHOD_LABELS[m]}</button>`).join('')}
        </div>
        ${extra}
        <button class="btn btn-primary btn-lg btn-block" id="btn-charge" style="margin-top:12px">
          Cobrar ${money(t)}
        </button>
      </div>`;

    zone.querySelectorAll('[data-method]').forEach(b => b.addEventListener('click', () => {
      sale.method = b.dataset.method;
      if (sale.method === 'credito' && !sale.customer) {
        chooseCustomer(true);
      }
      drawPay();
    }));
    const received = zone.querySelector('#received');
    if (received) {
      received.addEventListener('input', () => { sale.received = Number(received.value || 0); drawPay(); });
      zone.querySelectorAll('[data-cash]').forEach(b => b.addEventListener('click', () => {
        sale.received = Number(b.dataset.cash); drawPay();
      }));
    }
    zone.querySelectorAll('[data-mix]').forEach(inp => {
      inp.addEventListener('input', () => {
        sale.mixed[inp.dataset.mix] = Number(inp.value || 0);
        const sum = sale.mixed.efectivo + sale.mixed.tarjeta + sale.mixed.transferencia;
        const label = zone.querySelector('.line .mono');
        if (label) {
          label.textContent = money(sum);
          label.className = 'mono ' + (sum + 0.01 < total() ? 'danger-text' : 'ok-text');
        }
      });
    });
    const creditPaid = zone.querySelector('#credit-paid');
    if (creditPaid) creditPaid.addEventListener('input', () => { sale.creditPaid = Number(creditPaid.value || 0); });
    zone.querySelector('#btn-charge').addEventListener('click', charge);
  }

  function drawFab() {
    const t = total();
    $('fab').innerHTML = sale.lines.length ? `
      <button class="btn btn-primary btn-lg btn-block" id="fab-btn">
        🛒 ${sale.lines.length} items · ${money(t)} — Ir a cobrar</button>` : '';
    const btn = $('fab-btn');
    if (btn) btn.addEventListener('click', () => {
      view.querySelector('.pos-cart').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /* --------------------------------------------------------- cliente */
  async function chooseCustomer(force = false) {
    const result = await pickCustomer({ allowNone: !force });
    if (result === undefined) return;
    sale.customer = result;
    drawCustomer();
  }

  function drawCustomer() {
    const btn = $('btn-customer');
    if (!sale.customer) {
      btn.innerHTML = '👤 Consumidor final <span class="spacer"></span><span class="small muted">cambiar</span>';
    } else {
      const c = sale.customer;
      btn.innerHTML = `${c.type === 'finca' ? '🌾' : '👤'} <b>${esc(c.name)}</b>
        <span class="spacer"></span>
        ${c.pending > 0 ? `<span class="badge warn">Debe ${money(c.pending)}</span>` : '<span class="small muted">cambiar</span>'}`;
    }
  }

  /* ----------------------------------------------------------- cobro */
  async function charge() {
    if (!sale.lines.length) return notify.error('Agregue productos a la venta');
    if (!cashOpen) return notify.error('Debe abrir la caja antes de vender');
    const t = total();
    const isCredit = sale.method === 'credito';
    if (isCredit && !sale.customer) return notify.error('Seleccione el cliente para el fiado');

    let payments = [];
    if (sale.method === 'efectivo') {
      if (sale.received && sale.received + 0.01 < t) return notify.error('El efectivo recibido es menor al total');
      payments = [{ method: 'efectivo', amount: t }];
    } else if (sale.method === 'tarjeta' || sale.method === 'transferencia') {
      payments = [{ method: sale.method, amount: t }];
    } else if (sale.method === 'mixto') {
      payments = Object.entries(sale.mixed).filter(([, v]) => v > 0).map(([m, v]) => ({ method: m, amount: v }));
      const sum = payments.reduce((s, p) => s + p.amount, 0);
      if (sum + 0.01 < t) return notify.error('La suma de los pagos no cubre el total');
      if (sum > t) payments[0].amount = Math.round((payments[0].amount - (sum - t)) * 100) / 100;
    } else if (isCredit) {
      if (sale.creditPaid > 0) {
        if (sale.creditPaid >= t) return notify.error('El abono cubre todo: use otra forma de pago');
        payments = [{ method: 'efectivo', amount: sale.creditPaid }];
      }
    }

    const payload = {
      items: sale.lines.map(l => ({
        product_id: l.product_id, qty: l.qty, price: l.price, discount: l.discount,
      })),
      discount: sale.discount,
      payments,
      customer_id: sale.customer ? sale.customer.id : null,
      is_credit: isCredit,
      note: sale.note,
      order_id: sale.orderId,
    };

    const btn = $('btn-charge');
    btn.disabled = true;
    btn.textContent = 'Procesando...';
    try {
      const created = await api.post('/api/sales', payload);
      const change = sale.method === 'efectivo' && sale.received > t
        ? Math.round((sale.received - t) * 100) / 100 : 0;
      showResult(created, change);
      reset();
      loadProducts();
      refreshBadges();
    } catch (e) {
      notify.error(e.message);
      btn.disabled = false;
      btn.textContent = 'Cobrar ' + money(t);
    }
  }

  function showResult(created, change) {
    openModal({
      title: 'Venta registrada ' + created.folio,
      body: `
        <div style="text-align:center;padding:6px 0 14px">
          <div style="font-size:44px">✅</div>
          <div style="font-size:30px;font-weight:800">${money(created.total)}</div>
          ${change > 0 ? `<p class="strong" style="color:var(--naranja);font-size:18px">
            Cambio: ${money(change)}</p>` : ''}
          ${created.balance > 0 ? `<p class="badge warn" style="margin-top:6px">
            Queda a credito: ${money(created.balance)}</p>` : ''}
          <p class="small muted" style="margin-top:6px">
            ${created.customer_name ? esc(created.customer_name) : 'Consumidor final'} ·
            ${created.items.length} productos</p>
        </div>
        <div class="row">
          <button class="btn btn-soft" data-print>🖨️ Imprimir ticket</button>
          <button class="btn btn-soft" data-invoice>📄 Factura A4</button>
          <button class="btn btn-soft" data-download>⬇️ Descargar</button>
        </div>`,
      footer: `<button class="btn btn-primary btn-block" data-close>Nueva venta</button>`,
      onMount: (root) => {
        root.querySelector('[data-print]').addEventListener('click', () => printTicket(created, 'ticket'));
        root.querySelector('[data-invoice]').addEventListener('click', () => printTicket(created, 'factura'));
        root.querySelector('[data-download]').addEventListener('click', () => downloadTicket(created, 'ticket'));
      },
      onClose: () => scanInput.focus(),
    });
  }

  function reset() {
    sale.lines = [];
    sale.discount = 0;
    sale.customer = null;
    sale.method = 'efectivo';
    sale.received = 0;
    sale.mixed = { efectivo: 0, tarjeta: 0, transferencia: 0 };
    sale.creditPaid = 0;
    sale.orderId = null;
    drawCustomer();
    drawCart();
  }

  /* --------------------------------------------------------- escaner */
  scanInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const code = scanInput.value.trim();
    scanInput.value = '';
    if (!code) return;
    try {
      const product = await api.get('/api/products/scan', { code });
      addProduct(product);
      notify.ok(product.name);
    } catch (err) {
      searchInput.value = code;
      loadProducts();
      notify.error(err.message + ' — se busco por nombre');
    }
  });

  searchInput.addEventListener('input', debounce(loadProducts, 300));
  $('btn-clear-search').addEventListener('click', () => {
    searchInput.value = ''; scanInput.value = ''; activeCategory = 0;
    drawCategories(); loadProducts(); scanInput.focus();
  });
  $('btn-customer').addEventListener('click', () => chooseCustomer(false));
  $('btn-clear').addEventListener('click', async () => {
    if (!sale.lines.length) return;
    if (await confirmDialog({ title: 'Vaciar venta', message: '¿Descartar todos los productos?', danger: true })) reset();
  });

  setActions(`<button class="btn btn-soft btn-sm" id="act-cash">💰 Caja</button>`);
  const actCash = document.getElementById('act-cash');
  if (actCash) actCash.addEventListener('click', () => { location.hash = '#/cash'; });

  /* ------------------------------------------------ carga de pedido */
  async function loadOrder(orderId) {
    try {
      const order = await api.get('/api/orders/' + orderId);
      sale.customer = { id: order.customer_id, name: order.customer_name, type: order.customer_type };
      sale.orderId = order.id;
      for (const item of order.items) {
        if (!item.product_id) continue;
        const product = await api.get('/api/products/' + item.product_id);
        addProduct(product, item.qty);
      }
      drawCustomer();
      notify.info('Pedido ' + order.folio + ' cargado en la venta');
    } catch (e) {
      notify.error('No se pudo cargar el pedido: ' + e.message);
    }
  }

  drawCategories();
  drawCustomer();
  drawCart();
  await checkCash();
  await loadProducts();
  if (query.order) await loadOrder(query.order);
  if (window.innerWidth > 860) scanInput.focus();
}
