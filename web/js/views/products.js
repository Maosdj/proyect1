// Inventario: listado, CRUD de productos y movimientos de stock.

import { api, state } from '../api.js';
import {
  esc, money, qty as fmtQty, notify, formModal, openModal, confirmDialog, badgeStock,
  setActions, emptyState, debounce, dateTime,
} from '../ui.js';

const UNITS = ['unidad', 'kg', 'libra', 'litro', 'galon', 'bulto', 'metro', 'caja', 'rollo'];

export async function render(view) {
  const isAdmin = state.user.role === 'admin';
  let filters = { q: '', category: '', stock: '' };
  let items = [];
  let suppliers = [];

  if (isAdmin) {
    setActions(`<button class="btn btn-primary btn-sm" id="act-new">➕ Nuevo producto</button>`);
    document.getElementById('act-new').addEventListener('click', () => openForm());
  } else {
    setActions('');
  }

  view.innerHTML = `
    <div class="card">
      <div class="row">
        <div class="search-wrap">
          <input class="input" id="q" placeholder="Buscar por nombre, codigo, SKU o descripcion" autocomplete="off">
        </div>
        <select class="input" id="f-cat" style="max-width:200px">
          <option value="">Todas las categorias</option>
          ${state.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
        </select>
        <select class="input" id="f-stock" style="max-width:180px">
          <option value="">Todo el stock</option>
          <option value="alerta">⚠️ Con alerta</option>
          <option value="bajo">Stock bajo</option>
          <option value="agotado">Agotados</option>
        </select>
      </div>
    </div>
    <div id="summary" class="grid grid-4" style="margin-bottom:16px"></div>
    <div class="card"><div id="list">Cargando...</div></div>`;

  const $ = (id) => view.querySelector('#' + id);

  async function load() {
    $('list').innerHTML = '<p class="muted small">Cargando inventario...</p>';
    const res = await api.get('/api/products', { ...filters, limit: 500 });
    items = res.items;
    draw();
  }

  function draw() {
    const low = items.filter(p => p.stock_state === 'bajo').length;
    const out = items.filter(p => p.stock_state === 'agotado').length;
    const value = items.reduce((s, p) => s + p.stock * p.cost, 0);
    $('summary').innerHTML = `
      <div class="stat"><h3>Productos</h3><div class="value">${items.length}</div></div>
      <div class="stat amber"><h3>Stock bajo</h3><div class="value">${low}</div></div>
      <div class="stat red"><h3>Agotados</h3><div class="value">${out}</div></div>
      <div class="stat earth"><h3>Valor inventario</h3><div class="value">${money(value)}</div>
        <div class="sub">a precio de compra</div></div>`;

    if (!items.length) {
      $('list').innerHTML = emptyState('📦', 'Sin productos', 'Ajuste los filtros o cree uno nuevo');
      return;
    }

    $('list').innerHTML = `
      <div class="table-wrap"><table class="table">
        <thead><tr>
          <th>Producto</th><th>Categoria</th><th class="num">Compra</th><th class="num">Venta</th>
          <th class="num">Stock</th><th>Estado</th><th></th>
        </tr></thead>
        <tbody>${items.map(p => `
          <tr data-id="${p.id}">
            <td>
              <strong>${p.image || '📦'} ${esc(p.name)}</strong><br>
              <span class="small muted">${esc(p.sku || 's/n')}${p.barcode ? ' · ' + esc(p.barcode) : ''}
                ${p.supplier_name ? ' · ' + esc(p.supplier_name) : ''}</span>
            </td>
            <td class="small">${esc(p.category_name || '—')}</td>
            <td class="num">${isAdmin ? money(p.cost) : '—'}</td>
            <td class="num strong">${money(p.price)}</td>
            <td class="num">${fmtQty(p.stock)} <span class="small muted">${esc(p.unit)}</span><br>
              <span class="small muted">min ${fmtQty(p.min_stock)}</span></td>
            <td>${badgeStock(p)}</td>
            <td><div class="actions">
              <button class="btn btn-sm btn-soft" data-view="${p.id}">👁️</button>
              ${isAdmin ? `<button class="btn btn-sm btn-soft" data-move="${p.id}">📥</button>
              <button class="btn btn-sm btn-soft" data-edit="${p.id}">✏️</button>
              <button class="btn btn-sm btn-soft" data-del="${p.id}">🗑️</button>` : ''}
            </div></td>
          </tr>`).join('')}</tbody>
      </table></div>`;

    $('list').querySelectorAll('[data-view]').forEach(b =>
      b.addEventListener('click', () => showDetail(Number(b.dataset.view))));
    $('list').querySelectorAll('[data-edit]').forEach(b =>
      b.addEventListener('click', () => openForm(items.find(p => p.id === Number(b.dataset.edit)))));
    $('list').querySelectorAll('[data-move]').forEach(b =>
      b.addEventListener('click', () => moveForm(items.find(p => p.id === Number(b.dataset.move)))));
    $('list').querySelectorAll('[data-del]').forEach(b =>
      b.addEventListener('click', () => removeProduct(items.find(p => p.id === Number(b.dataset.del)))));
  }

  async function ensureSuppliers() {
    if (!suppliers.length && isAdmin) {
      try { suppliers = (await api.get('/api/suppliers')).items; } catch (e) { suppliers = []; }
    }
    return suppliers;
  }

  async function openForm(product) {
    await ensureSuppliers();
    const p = product || {};
    formModal({
      title: product ? 'Editar producto' : 'Nuevo producto',
      wide: true,
      submitLabel: product ? 'Guardar cambios' : 'Crear producto',
      fields: [
        { name: 'name', label: 'Nombre', value: p.name, required: true, full: true },
        { name: 'description', label: 'Descripcion', value: p.description, full: true },
        { name: 'category_id', label: 'Categoria', type: 'select', value: p.category_id,
          options: [{ value: '', label: '— Sin categoria —' }].concat(
            state.categories.map(c => ({ value: c.id, label: c.name }))) },
        { name: 'supplier_id', label: 'Proveedor', type: 'select', value: p.supplier_id,
          options: [{ value: '', label: '— Sin proveedor —' }].concat(
            suppliers.map(s => ({ value: s.id, label: s.name }))) },
        { name: 'unit', label: 'Unidad de medida', type: 'select', value: p.unit || 'unidad',
          options: UNITS },
        { name: 'image', label: 'Icono (emoji)', value: p.image || '📦' },
        { name: 'cost', label: 'Precio de compra', type: 'number', value: p.cost || 0, min: 0 },
        { name: 'price', label: 'Precio de venta', type: 'number', value: p.price || 0, min: 0, required: true },
        ...(product ? [] : [{ name: 'stock', label: 'Stock inicial', type: 'number', value: 0, min: 0 }]),
        { name: 'min_stock', label: 'Stock minimo', type: 'number', value: p.min_stock || 0, min: 0,
          hint: 'Para alertas de reposicion' },
        { name: 'sku', label: 'Codigo interno (SKU)', value: p.sku },
        { name: 'barcode', label: 'Codigo de barras', value: p.barcode },
        { name: 'visible', label: 'Mostrar en el catalogo del cliente', type: 'checkbox',
          value: product ? !!p.visible : true },
        { name: 'active', label: 'Producto activo', type: 'checkbox', value: product ? !!p.active : true },
      ],
      onSubmit: async (values, close) => {
        if (product) await api.put('/api/products/' + product.id, values);
        else await api.post('/api/products', values);
        notify.ok(product ? 'Producto actualizado' : 'Producto creado');
        close();
        load();
      },
    });
  }

  function moveForm(product) {
    formModal({
      title: 'Movimiento de inventario',
      submitLabel: 'Registrar',
      extraHtml: `<p class="small muted">Stock actual: <b>${fmtQty(product.stock)} ${esc(product.unit)}</b></p>`,
      fields: [
        { name: 'type', label: 'Tipo', type: 'select', value: 'entrada', options: [
          { value: 'entrada', label: 'Entrada (compra / reposicion)' },
          { value: 'salida', label: 'Salida (merma, daño, uso interno)' },
          { value: 'ajuste', label: 'Ajuste por conteo fisico' },
        ] },
        { name: 'qty', label: 'Cantidad', type: 'number', value: 1, min: 0, required: true,
          hint: 'En "ajuste" escriba la cantidad real contada' },
        { name: 'cost', label: 'Nuevo precio de compra (opcional)', type: 'number', value: '', min: 0 },
        { name: 'reason', label: 'Motivo / observacion', full: true },
      ],
      onSubmit: async (values, close) => {
        await api.post('/api/inventory/moves', { ...values, product_id: product.id });
        notify.ok('Movimiento registrado');
        close();
        load();
      },
    });
  }

  async function removeProduct(product) {
    const ok = await confirmDialog({
      title: 'Eliminar producto', danger: true, confirmLabel: 'Eliminar',
      message: `¿Eliminar "${product.name}"? Si tiene ventas asociadas se desactivara en lugar de borrarse.`,
    });
    if (!ok) return;
    try {
      const res = await api.del('/api/products/' + product.id);
      notify.ok(res.message || 'Producto eliminado');
      load();
    } catch (e) { notify.error(e.message); }
  }

  async function showDetail(id) {
    try {
      const p = await api.get('/api/products/' + id);
      openModal({
        title: p.name,
        wide: true,
        body: `
          <div class="grid grid-3" style="margin-bottom:14px">
            <div class="stat"><h3>Existencias</h3><div class="value">${fmtQty(p.stock)}</div>
              <div class="sub">${esc(p.unit)} · minimo ${fmtQty(p.min_stock)}</div></div>
            <div class="stat orange"><h3>Precio de venta</h3><div class="value">${money(p.price)}</div>
              ${isAdmin ? `<div class="sub">compra ${money(p.cost)} · margen ${p.margin_pct}%</div>` : ''}</div>
            <div class="stat earth"><h3>Valor en bodega</h3>
              <div class="value">${money(p.stock * p.price)}</div>
              <div class="sub">a precio de venta</div></div>
          </div>
          <p class="small muted">${esc(p.description || 'Sin descripcion')}</p>
          <p class="small">Categoria: <b>${esc(p.category_name || '—')}</b> ·
             Proveedor: <b>${esc(p.supplier_name || '—')}</b> ·
             SKU: <b>${esc(p.sku || '—')}</b> · Codigo: <b>${esc(p.barcode || '—')}</b></p>
          <h3 style="margin:16px 0 6px;font-size:14px">Ultimos movimientos</h3>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Fecha</th><th>Tipo</th><th class="num">Cant.</th>
              <th class="num">Stock</th><th>Motivo</th><th>Usuario</th></tr></thead>
            <tbody>${p.moves.map(m => `<tr>
              <td class="small nowrap">${dateTime(m.created_at)}</td>
              <td><span class="badge ${m.type === 'entrada' ? 'ok' : (m.type === 'salida' ? 'danger' : '')}">
                ${m.type}</span></td>
              <td class="num">${fmtQty(m.qty)}</td>
              <td class="num small">${fmtQty(m.stock_before)} → ${fmtQty(m.stock_after)}</td>
              <td class="small">${esc(m.reason || '')}</td>
              <td class="small">${esc(m.user_name || 'sistema')}</td></tr>`).join('')}</tbody>
          </table></div>`,
        footer: isAdmin ? `<button class="btn btn-soft" data-close>Cerrar</button>
          <button class="btn btn-primary" data-edit>Editar producto</button>` : '',
        onMount: (root, close) => {
          const btn = root.querySelector('[data-edit]');
          if (btn) btn.addEventListener('click', () => { close(); openForm(p); });
        },
      });
    } catch (e) { notify.error(e.message); }
  }

  $('q').addEventListener('input', debounce(() => { filters.q = $('q').value.trim(); load(); }, 300));
  $('f-cat').addEventListener('change', () => { filters.category = $('f-cat').value; load(); });
  $('f-stock').addEventListener('change', () => { filters.stock = $('f-stock').value; load(); });

  await load();
}
