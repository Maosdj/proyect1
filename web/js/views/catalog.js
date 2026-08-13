// Catalogo publico del cliente.

import { api, state } from '../api.js';
import {
  esc, money, qty as fmtQty, notify, setActions, emptyState, debounce, openModal,
} from '../ui.js';
import { addToCart, cartCount } from '../cart.js';
import { renderNav } from '../app.js';

export async function render(view) {
  let filters = { q: '', category: '', available: '', sort: 'nombre', min_price: '', max_price: '' };
  let items = [];

  setActions(`<button class="btn btn-primary btn-sm" id="act-cart">🧺 Mi pedido (${cartCount()})</button>`);
  document.getElementById('act-cart').addEventListener('click', () => { location.hash = '#/cart'; });

  view.innerHTML = `
    <div class="cat-hero">
      <h2>🌾 Insumos agricolas y ferreteria</h2>
      <p>Arme su pedido o solicite una cotizacion y recojala en la tienda.</p>
    </div>
    <div class="card">
      <div class="row" style="margin-bottom:10px">
        <div class="search-wrap">
          <input class="input" id="q" placeholder="¿Que necesita? Ej: abono, machete, tubo PVC" autocomplete="off">
        </div>
        <select class="input" id="f-sort" style="max-width:190px">
          <option value="nombre">Ordenar: A-Z</option>
          <option value="precio_asc">Menor precio</option>
          <option value="precio_desc">Mayor precio</option>
        </select>
      </div>
      <div class="chips" id="cats"></div>
      <div class="row" style="margin-top:10px">
        <input class="input" type="number" id="f-min" placeholder="Precio min" style="max-width:140px">
        <input class="input" type="number" id="f-max" placeholder="Precio max" style="max-width:140px">
        <label class="check" style="margin:0"><input type="checkbox" id="f-avail"> Solo disponibles</label>
        <span class="spacer"></span>
        <button class="btn btn-sm btn-soft" id="btn-reset">Limpiar filtros</button>
      </div>
    </div>
    <div id="grid">Cargando...</div>`;

  const $ = (id) => view.querySelector('#' + id);

  function drawCats() {
    $('cats').innerHTML = `<button class="chip ${!filters.category ? 'active' : ''}" data-cat="">Todo</button>` +
      state.categories.map(c => `<button class="chip ${String(filters.category) === String(c.id) ? 'active' : ''}"
        data-cat="${c.id}">${c.icon || ''} ${esc(c.name)}</button>`).join('');
    $('cats').querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => {
      filters.category = b.dataset.cat;
      drawCats();
      load();
    }));
  }

  async function load() {
    $('grid').innerHTML = '<p class="muted small">Buscando productos...</p>';
    const res = await api.get('/api/catalog', filters);
    items = res.items;
    if (!items.length) {
      $('grid').innerHTML = `<div class="card">${emptyState('🔍', 'No encontramos productos',
        'Pruebe con otra palabra o quite los filtros')}</div>`;
      return;
    }
    $('grid').innerHTML = `<div class="cat-grid">${items.map(p => `
      <div class="cat-card">
        <div class="cat-thumb clickable" data-detail="${p.id}">${p.image || '📦'}</div>
        <div class="cat-body">
          <span class="small muted">${esc(p.category_name || '')}</span>
          <span class="cname clickable" data-detail="${p.id}">${esc(p.name)}</span>
          <span class="cprice">${money(p.price)}
            <span class="small muted">/ ${esc(p.unit)}</span></span>
          ${p.available ? `<span class="badge ok">Disponible</span>`
            : `<span class="badge danger">Agotado</span>`}
          <button class="btn btn-primary btn-sm" data-add="${p.id}" ${p.available ? '' : 'disabled'}>
            ➕ Agregar</button>
        </div>
      </div>`).join('')}</div>`;

    $('grid').querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
      const p = items.find(x => x.id === Number(b.dataset.add));
      addToCart(p, 1);
      notify.ok(p.name + ' agregado al pedido');
      updateCartButton();
    }));
    $('grid').querySelectorAll('[data-detail]').forEach(el => el.addEventListener('click', () => {
      detail(items.find(x => x.id === Number(el.dataset.detail)));
    }));
  }

  function detail(p) {
    openModal({
      title: p.name,
      body: `
        <div style="text-align:center;font-size:64px">${p.image || '📦'}</div>
        <p class="small muted" style="text-align:center">${esc(p.category_name || '')}</p>
        <p style="margin:12px 0">${esc(p.description || 'Sin descripcion adicional.')}</p>
        <div class="row">
          <div class="stat" style="flex:1"><h3>Precio</h3>
            <div class="value">${money(p.price)}</div><div class="sub">por ${esc(p.unit)}</div></div>
          <div class="stat ${p.available ? '' : 'red'}" style="flex:1"><h3>Disponibilidad</h3>
            <div class="value" style="font-size:18px">${p.available ? fmtQty(p.stock) + ' ' + esc(p.unit) : 'Agotado'}</div></div>
        </div>
        <div class="field" style="margin-top:14px"><label>Cantidad</label>
          <input class="input input-lg" type="number" id="d-qty" value="1" min="0.01" step="any"></div>`,
      footer: `<button class="btn btn-soft" data-close>Cerrar</button>
        <button class="btn btn-primary" data-add ${p.available ? '' : 'disabled'}>Agregar al pedido</button>`,
      onMount: (root, close) => {
        const btn = root.querySelector('[data-add]');
        if (btn) btn.addEventListener('click', () => {
          const q = Number(root.querySelector('#d-qty').value || 1);
          if (q <= 0) return notify.error('Cantidad invalida');
          addToCart(p, q);
          notify.ok('Agregado al pedido');
          updateCartButton();
          close();
        });
      },
    });
  }

  function updateCartButton() {
    const btn = document.getElementById('act-cart');
    if (btn) btn.textContent = `🧺 Mi pedido (${cartCount()})`;
    renderNav();
  }

  $('q').addEventListener('input', debounce(() => { filters.q = $('q').value.trim(); load(); }, 300));
  $('f-sort').addEventListener('change', () => { filters.sort = $('f-sort').value; load(); });
  $('f-avail').addEventListener('change', () => { filters.available = $('f-avail').checked ? '1' : ''; load(); });
  $('f-min').addEventListener('change', () => { filters.min_price = $('f-min').value; load(); });
  $('f-max').addEventListener('change', () => { filters.max_price = $('f-max').value; load(); });
  $('btn-reset').addEventListener('click', () => {
    filters = { q: '', category: '', available: '', sort: 'nombre', min_price: '', max_price: '' };
    $('q').value = ''; $('f-min').value = ''; $('f-max').value = '';
    $('f-avail').checked = false; $('f-sort').value = 'nombre';
    drawCats(); load();
  });

  drawCats();
  await load();
}
