// Creditos y fiados: saldos pendientes por cliente y registro de abonos.

import { api } from '../api.js';
import {
  esc, money, notify, formModal, setActions, emptyState, dateOnly,
} from '../ui.js';

export async function render(view) {
  setActions('');
  view.innerHTML = `<div id="body">Cargando...</div>`;
  const body = view.querySelector('#body');

  async function load() {
    const res = await api.get('/api/credits');
    if (!res.items.length) {
      body.innerHTML = `<div class="card">${emptyState('✅', 'No hay creditos pendientes',
        'Todas las ventas a credito estan al dia')}</div>`;
      return;
    }
    const oldest = res.items.reduce((min, c) => (!min || c.oldest < min ? c.oldest : min), null);
    body.innerHTML = `
      <div class="grid grid-3" style="margin-bottom:16px">
        <div class="stat red"><h3>Total por cobrar</h3><div class="value">${money(res.total_pending)}</div></div>
        <div class="stat amber"><h3>Clientes con deuda</h3><div class="value">${res.items.length}</div></div>
        <div class="stat earth"><h3>Fiado mas antiguo</h3>
          <div class="value" style="font-size:18px">${dateOnly(oldest)}</div></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>📒 Saldos por cliente</h2></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Cliente</th><th>Contacto</th><th class="num">Facturas</th>
            <th class="num">Saldo</th><th class="num">Cupo</th><th></th></tr></thead>
          <tbody>${res.items.map(c => `
            <tr>
              <td><strong>${c.type === 'finca' ? '🌾' : '👤'} ${esc(c.name)}</strong>
                ${c.farm_name ? `<br><span class="small muted">${esc(c.farm_name)}</span>` : ''}</td>
              <td class="small">${esc(c.phone || '—')}</td>
              <td class="num">${c.open_invoices}</td>
              <td class="num strong danger-text">${money(c.pending)}</td>
              <td class="num small">${c.credit_limit ? money(c.credit_limit) : '—'}
                ${c.credit_limit ? `<div class="hbar" style="margin-top:4px">
                  <span style="width:${Math.min(100, c.pending / c.credit_limit * 100)}%"></span></div>` : ''}</td>
              <td><div class="actions">
                <button class="btn btn-sm btn-soft" data-detail="${c.id}">👁️</button>
                <button class="btn btn-sm btn-green" data-pay="${c.id}">💵 Abonar</button>
              </div></td>
            </tr>`).join('')}</tbody>
        </table></div>
      </div>`;

    body.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', () =>
      payForm(res.items.find(c => c.id === Number(b.dataset.pay)))));
    body.querySelectorAll('[data-detail]').forEach(b => b.addEventListener('click', () =>
      detail(res.items.find(c => c.id === Number(b.dataset.detail)))));
  }

  function payForm(c) {
    formModal({
      title: 'Abono de ' + c.name,
      extraHtml: `<p class="small">Saldo pendiente: <b class="danger-text">${money(c.pending)}</b>
        <br><span class="muted">El abono se aplica primero a las facturas mas antiguas.</span></p>`,
      submitLabel: 'Registrar abono',
      fields: [
        { name: 'amount', label: 'Valor del abono', type: 'number', value: c.pending, min: 0,
          required: true, full: true },
        { name: 'method', label: 'Forma de pago', type: 'select', value: 'efectivo',
          options: [{ value: 'efectivo', label: 'Efectivo' }, { value: 'tarjeta', label: 'Tarjeta' },
            { value: 'transferencia', label: 'Transferencia' }] },
        { name: 'note', label: 'Observacion', full: true },
      ],
      onSubmit: async (values, close) => {
        const res = await api.post('/api/credits/payments', { ...values, customer_id: c.id });
        notify.ok(`Abono de ${money(res.applied)} registrado`);
        close();
        load();
      },
    });
  }

  function detail(c) {
    formModal({
      title: 'Facturas pendientes - ' + c.name,
      fields: [],
      submitLabel: 'Cerrar',
      extraHtml: `<div class="table-wrap"><table class="table">
        <thead><tr><th>Fecha</th><th>Factura</th><th class="num">Total</th>
          <th class="num">Abonado</th><th class="num">Saldo</th></tr></thead>
        <tbody>${c.invoices.map(i => `<tr>
          <td class="small nowrap">${dateOnly(i.created_at)}</td>
          <td><b>${esc(i.folio)}</b></td>
          <td class="num">${money(i.total)}</td>
          <td class="num ok-text">${money(i.paid)}</td>
          <td class="num danger-text strong">${money(i.balance)}</td>
        </tr>`).join('')}</tbody></table></div>`,
      onSubmit: async (values, close) => close(),
    });
  }

  await load();
}
