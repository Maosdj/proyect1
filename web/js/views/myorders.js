// Pedidos y cotizaciones del cliente.

import { api } from '../api.js';
import {
  esc, money, qty as fmtQty, notify, setActions, emptyState, dateTime, orderStatusBadge, confirmDialog,
} from '../ui.js';

const HINTS = {
  pendiente: 'Estamos revisando su solicitud.',
  aprobado: 'Aprobado. Lo estamos preparando.',
  listo: '¡Listo para recoger en la tienda!',
  entregado: 'Entregado. Gracias por su compra.',
  cancelado: 'Esta solicitud fue cancelada.',
};

export async function render(view) {
  setActions(`<a class="btn btn-primary btn-sm" href="#/catalog">🛒 Seguir comprando</a>`);
  view.innerHTML = '<p class="muted small">Cargando sus pedidos...</p>';

  async function load() {
    const [orders, purchases] = await Promise.all([
      api.get('/api/me/orders'),
      api.get('/api/me/purchases'),
    ]);

    view.innerHTML = `
      <div class="card">
        <div class="card-head"><h2>📦 Mis pedidos y cotizaciones</h2></div>
        ${orders.items.length ? `<div class="grid grid-2">${orders.items.map(o => `
          <div class="card card-flat" style="margin:0;background:#fbfaf7">
            <div class="card-head">
              <span style="font-size:20px">${o.type === 'cotizacion' ? '📄' : '📦'}</span>
              <div style="flex:1"><h2>${esc(o.folio)}</h2>
                <p class="small muted">${dateTime(o.created_at)}</p></div>
              <div class="right strong">${money(o.total)}</div>
            </div>
            <div>${orderStatusBadge(o.status)}
              <span class="small muted"> ${esc(HINTS[o.status] || '')}</span></div>
            <div class="table-wrap" style="margin-top:8px"><table class="table">
              <tbody>${o.items.map(i => `<tr>
                <td class="small">${esc(i.name)}</td>
                <td class="num small">${fmtQty(i.qty)} ${esc(i.unit)}</td>
                <td class="num small">${money(i.subtotal)}</td></tr>`).join('')}</tbody></table></div>
            ${o.note ? `<p class="small muted">📝 ${esc(o.note)}</p>` : ''}
            ${['pendiente', 'aprobado'].includes(o.status)
              ? `<button class="btn btn-sm btn-soft" data-cancel="${o.id}" style="margin-top:8px">
                  Cancelar solicitud</button>` : ''}
          </div>`).join('')}</div>`
          : emptyState('📦', 'Aun no ha hecho pedidos', 'Arme su pedido desde el catalogo')}
      </div>

      <div class="card">
        <div class="card-head"><h2>🧾 Mis compras en la tienda</h2></div>
        ${purchases.items.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Fecha</th><th>Factura</th><th>Productos</th><th class="num">Total</th>
            <th class="num">Saldo</th></tr></thead>
          <tbody>${purchases.items.map(s => `<tr style="${s.status === 'anulada' ? 'opacity:.5' : ''}">
            <td class="small nowrap">${dateTime(s.created_at)}</td>
            <td><b>${esc(s.folio)}</b>${s.status === 'anulada' ? ' <span class="badge danger">anulada</span>' : ''}</td>
            <td class="small">${esc(s.items.slice(0, 3).map(i => i.name).join(', '))}
              ${s.items.length > 3 ? ` y ${s.items.length - 3} mas` : ''}</td>
            <td class="num strong">${money(s.total)}</td>
            <td class="num ${s.balance > 0 ? 'danger-text' : 'muted'}">${money(s.balance)}</td>
          </tr>`).join('')}</tbody></table></div>`
          : emptyState('🧾', 'Sin compras registradas todavia')}
      </div>`;

    view.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Cancelar solicitud', danger: true, confirmLabel: 'Si, cancelar',
        message: '¿Desea cancelar esta solicitud?',
      });
      if (!ok) return;
      try {
        await api.post(`/api/me/orders/${b.dataset.cancel}/cancel`);
        notify.ok('Solicitud cancelada');
        load();
      } catch (e) { notify.error(e.message); }
    }));
  }

  await load();
}
