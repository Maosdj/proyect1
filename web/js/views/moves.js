// Historial de movimientos de inventario (entradas, salidas y ajustes).

import { api } from '../api.js';
import { esc, qty as fmtQty, dateTime, emptyState, daysAgo, today, setActions } from '../ui.js';

export async function render(view) {
  setActions('');
  view.innerHTML = `
    <div class="card">
      <div class="row">
        <select class="input" id="f-type" style="max-width:190px">
          <option value="">Todos los tipos</option>
          <option value="entrada">Entradas</option>
          <option value="salida">Salidas</option>
          <option value="ajuste">Ajustes</option>
        </select>
        <div class="field" style="margin:0"><label class="small">Desde</label>
          <input class="input" type="date" id="f-from" value="${daysAgo(30)}"></div>
        <div class="field" style="margin:0"><label class="small">Hasta</label>
          <input class="input" type="date" id="f-to" value="${today()}"></div>
      </div>
    </div>
    <div class="card"><div id="list">Cargando...</div></div>`;

  const $ = (id) => view.querySelector('#' + id);

  async function load() {
    $('list').innerHTML = '<p class="muted small">Cargando movimientos...</p>';
    const res = await api.get('/api/inventory/moves', {
      type: $('f-type').value, from: $('f-from').value, to: $('f-to').value, limit: 400,
    });
    if (!res.items.length) {
      $('list').innerHTML = emptyState('🔁', 'Sin movimientos en el periodo');
      return;
    }
    $('list').innerHTML = `
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th class="num">Cantidad</th>
          <th class="num">Stock</th><th>Motivo</th><th>Usuario</th></tr></thead>
        <tbody>${res.items.map(m => `<tr>
          <td class="small nowrap">${dateTime(m.created_at)}</td>
          <td><strong>${esc(m.product_name || 'Producto eliminado')}</strong></td>
          <td><span class="badge ${m.type === 'entrada' ? 'ok' : (m.type === 'salida' ? 'danger' : 'warn')}">
            ${m.type}</span></td>
          <td class="num">${m.type === 'salida' ? '−' : '+'}${fmtQty(m.qty)}
            <span class="small muted">${esc(m.unit || '')}</span></td>
          <td class="num small">${fmtQty(m.stock_before)} → <b>${fmtQty(m.stock_after)}</b></td>
          <td class="small">${esc(m.reason || '')}</td>
          <td class="small">${esc(m.user_name || 'sistema')}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;
  }

  ['f-type', 'f-from', 'f-to'].forEach(id => $(id).addEventListener('change', load));
  await load();
}
