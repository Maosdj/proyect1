// Historial de ventas con detalle, reimpresion y anulacion.

import { api, state } from '../api.js';
import {
  esc, money, qty as fmtQty, notify, openModal, confirmDialog, setActions, emptyState,
  dateTime, daysAgo, today, payBadge, debounce,
} from '../ui.js';
import { printTicket, downloadTicket } from '../ticket.js';

export async function render(view) {
  const isAdmin = state.user.role === 'admin';
  setActions('');
  view.innerHTML = `
    <div class="card">
      <div class="row">
        <div class="search-wrap">
          <input class="input" id="q" placeholder="Buscar por folio o cliente" autocomplete="off">
        </div>
        <div class="field" style="margin:0"><label class="small">Desde</label>
          <input class="input" type="date" id="f-from" value="${daysAgo(7)}"></div>
        <div class="field" style="margin:0"><label class="small">Hasta</label>
          <input class="input" type="date" id="f-to" value="${today()}"></div>
        <label class="check" style="margin:0"><input type="checkbox" id="f-credit"> Solo fiados</label>
      </div>
    </div>
    <div id="summary" class="grid grid-3" style="margin-bottom:16px"></div>
    <div class="card"><div id="list">Cargando...</div></div>`;

  const $ = (id) => view.querySelector('#' + id);

  async function load() {
    $('list').innerHTML = '<p class="muted small">Cargando ventas...</p>';
    const res = await api.get('/api/sales', {
      q: $('q').value.trim(), from: $('f-from').value, to: $('f-to').value,
      credit: $('f-credit').checked ? '1' : '', limit: 300,
    });

    $('summary').innerHTML = `
      <div class="stat"><h3>Ventas del periodo</h3><div class="value">${res.totals.count}</div></div>
      <div class="stat orange"><h3>Total facturado</h3><div class="value">${money(res.totals.total)}</div></div>
      <div class="stat amber"><h3>Pendiente por cobrar</h3><div class="value">${money(res.totals.pending)}</div></div>`;

    if (!res.items.length) { $('list').innerHTML = emptyState('📜', 'Sin ventas en el periodo'); return; }

    $('list').innerHTML = `
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Fecha</th><th>Folio</th><th>Cliente</th><th>Vendedor</th>
          <th class="num">Total</th><th class="num">Saldo</th><th>Pago</th><th></th></tr></thead>
        <tbody>${res.items.map(s => `<tr style="${s.status === 'anulada' ? 'opacity:.55' : ''}">
          <td class="small nowrap">${dateTime(s.created_at)}</td>
          <td><b>${esc(s.folio)}</b></td>
          <td class="small">${esc(s.customer_name || 'Consumidor final')}</td>
          <td class="small">${esc(s.user_name || '')}</td>
          <td class="num strong">${money(s.total)}</td>
          <td class="num ${s.balance > 0 ? 'danger-text' : 'muted'}">${money(s.balance)}</td>
          <td>${payBadge(s)}</td>
          <td><div class="actions"><button class="btn btn-sm btn-soft" data-view="${s.id}">👁️</button></div></td>
        </tr>`).join('')}</tbody>
      </table></div>`;

    $('list').querySelectorAll('[data-view]').forEach(b =>
      b.addEventListener('click', () => detail(Number(b.dataset.view))));
  }

  async function detail(id) {
    const s = await api.get('/api/sales/' + id);
    openModal({
      title: 'Venta ' + s.folio,
      wide: true,
      body: `
        <div class="row" style="margin-bottom:12px">
          <div><span class="small muted">Fecha</span><br><b>${dateTime(s.created_at)}</b></div>
          <div><span class="small muted">Cliente</span><br><b>${esc(s.customer_name || 'Consumidor final')}</b></div>
          <div><span class="small muted">Vendedor</span><br><b>${esc(s.user_name || '')}</b></div>
          <div><span class="small muted">Estado</span><br>${payBadge(s)}</div>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">Precio</th>
            <th class="num">Dcto</th><th class="num">Subtotal</th></tr></thead>
          <tbody>${s.items.map(i => `<tr>
            <td>${esc(i.name)}</td>
            <td class="num">${fmtQty(i.qty)} <span class="small muted">${esc(i.unit)}</span></td>
            <td class="num">${money(i.price)}</td>
            <td class="num">${i.discount ? '−' + money(i.discount) : '—'}</td>
            <td class="num strong">${money(i.subtotal)}</td></tr>`).join('')}</tbody>
        </table></div>
        <div class="totals">
          <div class="line"><span>Subtotal</span><span class="mono">${money(s.subtotal)}</span></div>
          ${s.discount ? `<div class="line"><span>Descuento</span><span class="mono">− ${money(s.discount)}</span></div>` : ''}
          <div class="line grand"><span>Total</span><span class="mono">${money(s.total)}</span></div>
          ${s.payments.map(p => `<div class="line"><span class="small muted">Pago ${esc(p.method)}</span>
            <span class="mono small">${money(p.amount)}</span></div>`).join('')}
          ${s.balance > 0 ? `<div class="line"><span class="danger-text strong">Saldo pendiente</span>
            <span class="mono danger-text strong">${money(s.balance)}</span></div>` : ''}
        </div>
        ${s.credit_payments.length ? `<h3 style="font-size:14px;margin:14px 0 6px">Abonos</h3>
          ${s.credit_payments.map(p => `<div class="list-item"><span class="li-ic">💵</span>
            <span class="li-body"><strong>${money(p.amount)}</strong>
            <small>${dateTime(p.created_at)} · ${esc(p.method)}</small></span></div>`).join('')}` : ''}
        ${s.note ? `<p class="small muted" style="margin-top:10px">📝 ${esc(s.note)}</p>` : ''}`,
      footer: `
        <button class="btn btn-soft" data-print>🖨️ Ticket</button>
        <button class="btn btn-soft" data-invoice>📄 Factura A4</button>
        <button class="btn btn-soft" data-download>⬇️ Descargar</button>
        ${isAdmin && s.status === 'completada'
          ? '<button class="btn btn-danger" data-void>Anular venta</button>' : ''}`,
      onMount: (root, close) => {
        root.querySelector('[data-print]').addEventListener('click', () => printTicket(s, 'ticket'));
        root.querySelector('[data-invoice]').addEventListener('click', () => printTicket(s, 'factura'));
        root.querySelector('[data-download]').addEventListener('click', () => downloadTicket(s, 'factura'));
        const voidBtn = root.querySelector('[data-void]');
        if (voidBtn) voidBtn.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: 'Anular venta', danger: true, confirmLabel: 'Anular',
            message: 'Se devolvera el stock de los productos y la venta quedara marcada como anulada.',
          });
          if (!ok) return;
          try {
            await api.post(`/api/sales/${s.id}/void`, { reason: 'Anulada desde historial' });
            notify.ok('Venta anulada y stock devuelto');
            close();
            load();
          } catch (e) { notify.error(e.message); }
        });
      },
    });
  }

  $('q').addEventListener('input', debounce(load, 300));
  ['f-from', 'f-to', 'f-credit'].forEach(id => $(id).addEventListener('change', load));
  await load();
}
