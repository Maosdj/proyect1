// Estado de credito del cliente.

import { api } from '../api.js';
import { esc, money, setActions, emptyState, dateTime, dateOnly } from '../ui.js';

export async function render(view) {
  setActions('');
  const c = await api.get('/api/me/credit');
  const usedPct = c.credit_limit ? Math.min(100, c.pending / c.credit_limit * 100) : 0;

  view.innerHTML = `
    <div class="grid grid-3" style="margin-bottom:16px">
      <div class="stat ${c.pending > 0 ? 'red' : ''}"><h3>Saldo pendiente</h3>
        <div class="value">${money(c.pending)}</div>
        <div class="sub">${c.invoices.length} facturas por pagar</div></div>
      <div class="stat earth"><h3>Cupo asignado</h3>
        <div class="value">${c.credit_limit ? money(c.credit_limit) : 'Sin cupo'}</div>
        ${c.credit_limit ? `<div class="hbar" style="margin-top:8px">
          <span style="width:${usedPct}%"></span></div>` : ''}</div>
      <div class="stat"><h3>Disponible</h3>
        <div class="value">${c.credit_limit ? money(c.available) : '—'}</div>
        <div class="sub">para nuevas compras a credito</div></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>📒 Facturas pendientes</h2></div>
      ${c.invoices.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Fecha</th><th>Factura</th><th class="num">Total</th>
          <th class="num">Abonado</th><th class="num">Saldo</th></tr></thead>
        <tbody>${c.invoices.map(i => `<tr>
          <td class="small nowrap">${dateOnly(i.created_at)}</td>
          <td><b>${esc(i.folio)}</b></td>
          <td class="num">${money(i.total)}</td>
          <td class="num ok-text">${money(i.paid)}</td>
          <td class="num danger-text strong">${money(i.balance)}</td>
        </tr>`).join('')}</tbody></table></div>`
        : emptyState('✅', 'No tiene deudas pendientes', 'Su cuenta esta al dia')}
    </div>

    <div class="card">
      <div class="card-head"><h2>💵 Abonos registrados</h2></div>
      ${c.payments.length ? c.payments.map(p => `
        <div class="list-item">
          <span class="li-ic">💵</span>
          <span class="li-body"><strong>${money(p.amount)}</strong>
            <small>${dateTime(p.created_at)} · ${esc(p.method)}${p.folio ? ' · factura ' + esc(p.folio) : ''}</small></span>
        </div>`).join('') : emptyState('💵', 'Sin abonos registrados')}
      <p class="small muted" style="margin-top:10px">
        Los abonos se registran en la tienda. Si ve alguna diferencia, comuniquese con la ferreteria.</p>
    </div>`;
}
