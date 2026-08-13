// Pedidos y cotizaciones enviados por los clientes.

import { api } from '../api.js';
import {
  esc, money, qty as fmtQty, notify, setActions, emptyState, dateTime, orderStatusBadge,
  confirmDialog, debounce,
} from '../ui.js';
import { refreshBadges } from '../app.js';

const NEXT = {
  pendiente: [['aprobado', 'Aprobar', 'btn-green'], ['cancelado', 'Rechazar', 'btn-soft']],
  aprobado: [['listo', 'Marcar listo para recoger', 'btn-primary'], ['cancelado', 'Cancelar', 'btn-soft']],
  listo: [['entregado', 'Marcar entregado', 'btn-green'], ['cancelado', 'Cancelar', 'btn-soft']],
  entregado: [],
  cancelado: [],
};

export async function render(view) {
  setActions('');
  view.innerHTML = `
    <div class="card">
      <div class="row">
        <div class="search-wrap">
          <input class="input" id="q" placeholder="Buscar por folio o cliente" autocomplete="off">
        </div>
        <select class="input" id="f-status" style="max-width:200px">
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendientes</option>
          <option value="aprobado">Aprobados</option>
          <option value="listo">Listos para recoger</option>
          <option value="entregado">Entregados</option>
          <option value="cancelado">Cancelados</option>
        </select>
        <select class="input" id="f-type" style="max-width:180px">
          <option value="">Pedidos y cotizaciones</option>
          <option value="pedido">Solo pedidos</option>
          <option value="cotizacion">Solo cotizaciones</option>
        </select>
      </div>
    </div>
    <div id="list">Cargando...</div>`;

  const $ = (id) => view.querySelector('#' + id);

  async function load() {
    $('list').innerHTML = '<p class="muted small">Cargando pedidos...</p>';
    const res = await api.get('/api/orders', {
      q: $('q').value.trim(), status: $('f-status').value, type: $('f-type').value,
    });
    if (!res.items.length) {
      $('list').innerHTML = `<div class="card">${emptyState('📥', 'Sin pedidos',
        'Aqui apareceran las solicitudes que hagan los clientes desde el catalogo')}</div>`;
      return;
    }
    $('list').innerHTML = `<div class="grid grid-2">${res.items.map(o => `
      <div class="card" style="margin:0">
        <div class="card-head">
          <span style="font-size:22px">${o.type === 'cotizacion' ? '📄' : '📥'}</span>
          <div style="flex:1">
            <h2>${esc(o.folio)} ${orderStatusBadge(o.status)}</h2>
            <p class="small muted">${dateTime(o.created_at)} ·
              ${o.type === 'cotizacion' ? 'Cotizacion' : 'Pedido'}</p>
          </div>
          <div class="right"><div class="strong" style="font-size:19px">${money(o.total)}</div></div>
        </div>
        <p class="small">
          <b>${o.customer_type === 'finca' ? '🌾' : '👤'} ${esc(o.customer_name)}</b>
          ${o.customer_phone ? ' · 📞 ' + esc(o.customer_phone) : ''}</p>
        ${o.note ? `<p class="small muted">📝 ${esc(o.note)}</p>` : ''}
        <div class="table-wrap" style="margin-top:8px"><table class="table">
          <tbody>${o.items.map(i => `<tr>
            <td>${esc(i.name)}</td>
            <td class="num small">${fmtQty(i.qty)} ${esc(i.unit)}</td>
            <td class="num">${money(i.subtotal)}</td></tr>`).join('')}</tbody>
        </table></div>
        <div class="row" style="margin-top:12px">
          ${(NEXT[o.status] || []).map(([status, label, cls]) =>
            `<button class="btn btn-sm ${cls}" data-status="${o.id}|${status}">${label}</button>`).join('')}
          ${['pendiente', 'aprobado', 'listo'].includes(o.status)
            ? `<button class="btn btn-sm btn-primary" data-bill="${o.id}">🧾 Facturar en POS</button>` : ''}
          ${o.sale_id ? `<span class="badge ok">Facturado</span>` : ''}
        </div>
      </div>`).join('')}</div>`;

    $('list').querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', async () => {
      const [id, status] = b.dataset.status.split('|');
      if (status === 'cancelado') {
        const ok = await confirmDialog({
          title: 'Cancelar pedido', danger: true, confirmLabel: 'Si, cancelar',
          message: '¿Seguro que desea cancelar este pedido?',
        });
        if (!ok) return;
      }
      try {
        await api.put(`/api/orders/${id}/status`, { status });
        notify.ok('Pedido actualizado');
        load();
        refreshBadges();
      } catch (e) { notify.error(e.message); }
    }));

    $('list').querySelectorAll('[data-bill]').forEach(b => b.addEventListener('click', () => {
      location.hash = '#/pos?order=' + b.dataset.bill;
    }));
  }

  $('q').addEventListener('input', debounce(load, 300));
  $('f-status').addEventListener('change', load);
  $('f-type').addEventListener('change', load);
  await load();
}
