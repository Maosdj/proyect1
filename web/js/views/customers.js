// Clientes: fichas, historial de compras y control de fiados.

import { api, state } from '../api.js';
import {
  esc, money, notify, formModal, openModal, confirmDialog, setActions, emptyState,
  debounce, dateTime, dateOnly, qty as fmtQty, payBadge, orderStatusBadge,
} from '../ui.js';
import { newCustomerForm } from '../pickers.js';
import { printTicket } from '../ticket.js';

export async function render(view) {
  const isAdmin = state.user.role === 'admin';
  let items = [];

  setActions(`<button class="btn btn-primary btn-sm" id="act-new">➕ Nuevo cliente</button>`);
  document.getElementById('act-new').addEventListener('click', () => newCustomerForm(() => load()));

  view.innerHTML = `
    <div class="card">
      <div class="row">
        <div class="search-wrap">
          <input class="input" id="q" placeholder="Buscar por nombre, telefono, cedula o finca" autocomplete="off">
        </div>
        <select class="input" id="f-type" style="max-width:210px">
          <option value="">Todos los tipos</option>
          <option value="particular">Particulares</option>
          <option value="finca">Fincas / Empresas</option>
        </select>
      </div>
    </div>
    <div id="summary" class="grid grid-4" style="margin-bottom:16px"></div>
    <div class="card"><div id="list">Cargando...</div></div>`;

  const $ = (id) => view.querySelector('#' + id);

  async function load() {
    $('list').innerHTML = '<p class="muted small">Cargando clientes...</p>';
    const res = await api.get('/api/customers', { q: $('q').value.trim(), type: $('f-type').value });
    items = res.items;
    draw();
  }

  function draw() {
    const debtors = items.filter(c => c.pending > 0);
    const pending = debtors.reduce((s, c) => s + c.pending, 0);
    $('summary').innerHTML = `
      <div class="stat"><h3>Clientes</h3><div class="value">${items.length}</div></div>
      <div class="stat earth"><h3>Fincas / empresas</h3>
        <div class="value">${items.filter(c => c.type === 'finca').length}</div></div>
      <div class="stat amber"><h3>Con fiado</h3><div class="value">${debtors.length}</div></div>
      <div class="stat red"><h3>Total por cobrar</h3><div class="value">${money(pending)}</div></div>`;

    if (!items.length) { $('list').innerHTML = emptyState('👥', 'Sin clientes'); return; }

    $('list').innerHTML = `
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Cliente</th><th>Contacto</th><th class="num">Compras</th>
          <th class="num">Total comprado</th><th class="num">Saldo fiado</th><th></th></tr></thead>
        <tbody>${items.map(c => `<tr>
          <td>
            <strong>${c.type === 'finca' ? '🌾' : '👤'} ${esc(c.name)}</strong>
            ${c.active ? '' : '<span class="badge">inactivo</span>'}<br>
            <span class="small muted">${esc(c.farm_name || (c.doc ? 'Doc. ' + c.doc : ''))}</span>
          </td>
          <td class="small">${esc(c.phone || '—')}<br><span class="muted">${esc(c.address || '')}</span></td>
          <td class="num">${c.purchases}</td>
          <td class="num">${money(c.spent)}</td>
          <td class="num ${c.pending > 0 ? 'danger-text strong' : 'muted'}">${money(c.pending)}
            ${c.credit_limit ? `<br><span class="small muted">cupo ${money(c.credit_limit)}</span>` : ''}</td>
          <td><div class="actions">
            <button class="btn btn-sm btn-soft" data-view="${c.id}">👁️</button>
            ${c.pending > 0 ? `<button class="btn btn-sm btn-green" data-pay="${c.id}">💵 Abonar</button>` : ''}
            <button class="btn btn-sm btn-soft" data-edit="${c.id}">✏️</button>
            ${isAdmin ? `<button class="btn btn-sm btn-soft" data-del="${c.id}">🗑️</button>` : ''}
          </div></td>
        </tr>`).join('')}</tbody>
      </table></div>`;

    $('list').querySelectorAll('[data-view]').forEach(b =>
      b.addEventListener('click', () => detail(Number(b.dataset.view))));
    $('list').querySelectorAll('[data-edit]').forEach(b =>
      b.addEventListener('click', () => editForm(items.find(c => c.id === Number(b.dataset.edit)))));
    $('list').querySelectorAll('[data-pay]').forEach(b =>
      b.addEventListener('click', () => payForm(items.find(c => c.id === Number(b.dataset.pay)))));
    $('list').querySelectorAll('[data-del]').forEach(b =>
      b.addEventListener('click', () => remove(items.find(c => c.id === Number(b.dataset.del)))));
  }

  function editForm(c) {
    formModal({
      title: 'Editar cliente',
      fields: [
        { name: 'name', label: 'Nombre o razon social', value: c.name, required: true, full: true },
        { name: 'doc', label: 'Cedula / NIT', value: c.doc },
        { name: 'phone', label: 'Telefono', value: c.phone },
        { name: 'email', label: 'Correo', value: c.email },
        { name: 'type', label: 'Tipo', type: 'select', value: c.type,
          options: [{ value: 'particular', label: 'Particular' }, { value: 'finca', label: 'Finca / Empresa' }] },
        { name: 'farm_name', label: 'Finca / negocio', value: c.farm_name },
        { name: 'address', label: 'Direccion', value: c.address, full: true },
        ...(isAdmin ? [{ name: 'credit_limit', label: 'Cupo de credito', type: 'number',
          value: c.credit_limit, min: 0 }] : []),
        { name: 'notes', label: 'Notas', type: 'textarea', value: c.notes, full: true },
      ],
      onSubmit: async (values, close) => {
        await api.put('/api/customers/' + c.id, values);
        notify.ok('Cliente actualizado');
        close();
        load();
      },
    });
  }

  function payForm(c, onDone) {
    formModal({
      title: 'Registrar abono - ' + c.name,
      extraHtml: `<p class="small">Saldo pendiente: <b class="danger-text">${money(c.pending)}</b></p>`,
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
        notify.ok(`Abono de ${money(res.applied)} registrado. Saldo: ${money(res.pending)}`);
        close();
        load();
        if (onDone) onDone();
      },
    });
  }

  async function remove(c) {
    const ok = await confirmDialog({
      title: 'Eliminar cliente', danger: true, confirmLabel: 'Eliminar',
      message: `¿Eliminar a "${c.name}"? Si tiene compras se marcara como inactivo.`,
    });
    if (!ok) return;
    try {
      const res = await api.del('/api/customers/' + c.id);
      notify.ok(res.message || 'Cliente eliminado');
      load();
    } catch (e) { notify.error(e.message); }
  }

  async function detail(id) {
    const c = await api.get('/api/customers/' + id);
    const salesRows = c.sales.length ? c.sales.map(s => `
      <tr class="clickable" data-sale="${s.id}">
        <td class="small nowrap">${dateTime(s.created_at)}</td>
        <td><b>${esc(s.folio)}</b><br><span class="small muted">${s.items.length} productos ·
          ${esc(s.items.slice(0, 2).map(i => i.name).join(', '))}${s.items.length > 2 ? '...' : ''}</span></td>
        <td class="num">${money(s.total)}</td>
        <td class="num ${s.balance > 0 ? 'danger-text' : ''}">${money(s.balance)}</td>
        <td>${payBadge(s)}</td>
      </tr>`).join('') : '<tr><td colspan="5" class="muted small">Sin compras registradas</td></tr>';

    openModal({
      title: c.name,
      wide: true,
      body: `
        <div class="grid grid-4" style="margin-bottom:14px">
          <div class="stat"><h3>Compras</h3><div class="value">${c.sales.filter(s => s.status === 'completada').length}</div></div>
          <div class="stat earth"><h3>Total comprado</h3>
            <div class="value">${money(c.sales.filter(s => s.status === 'completada').reduce((s, x) => s + x.total, 0))}</div></div>
          <div class="stat ${c.pending > 0 ? 'red' : ''}"><h3>Saldo fiado</h3>
            <div class="value">${money(c.pending)}</div>
            ${c.credit_limit ? `<div class="sub">cupo ${money(c.credit_limit)}</div>` : ''}</div>
          <div class="stat orange"><h3>Pedidos</h3><div class="value">${c.orders.length}</div></div>
        </div>
        <p class="small">
          ${c.type === 'finca' ? '🌾 Finca / Empresa' : '👤 Particular'}
          ${c.farm_name ? ' · ' + esc(c.farm_name) : ''} ·
          📞 ${esc(c.phone || '—')} · 📍 ${esc(c.address || '—')} ·
          Doc: ${esc(c.doc || '—')}
          ${c.user ? ` · 🔐 Cuenta web: ${esc(c.user.email)}` : ' · sin cuenta web'}
        </p>
        ${c.notes ? `<p class="small muted">📝 ${esc(c.notes)}</p>` : ''}

        <h3 style="margin:16px 0 6px;font-size:14px">Historial de compras</h3>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Fecha</th><th>Venta</th><th class="num">Total</th>
            <th class="num">Saldo</th><th>Pago</th></tr></thead>
          <tbody>${salesRows}</tbody></table></div>

        ${c.credit_payments.length ? `
          <h3 style="margin:16px 0 6px;font-size:14px">Abonos recibidos</h3>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Fecha</th><th>Factura</th><th class="num">Valor</th><th>Forma</th><th>Recibio</th></tr></thead>
            <tbody>${c.credit_payments.map(p => `<tr>
              <td class="small nowrap">${dateTime(p.created_at)}</td>
              <td class="small">${esc(p.folio || '—')}</td>
              <td class="num ok-text">${money(p.amount)}</td>
              <td class="small">${esc(p.method)}</td>
              <td class="small">${esc(p.user_name || '')}</td></tr>`).join('')}</tbody>
          </table></div>` : ''}

        ${c.orders.length ? `
          <h3 style="margin:16px 0 6px;font-size:14px">Pedidos y cotizaciones</h3>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Fecha</th><th>Folio</th><th>Tipo</th><th class="num">Total</th><th>Estado</th></tr></thead>
            <tbody>${c.orders.map(o => `<tr>
              <td class="small nowrap">${dateOnly(o.created_at)}</td>
              <td><b>${esc(o.folio)}</b></td>
              <td class="small">${esc(o.type)}</td>
              <td class="num">${money(o.total)}</td>
              <td>${orderStatusBadge(o.status)}</td></tr>`).join('')}</tbody>
          </table></div>` : ''}`,
      footer: `${c.pending > 0 ? '<button class="btn btn-green" data-abonar>💵 Registrar abono</button>' : ''}
               <button class="btn btn-soft" data-close>Cerrar</button>`,
      onMount: (root, close) => {
        const btn = root.querySelector('[data-abonar]');
        if (btn) btn.addEventListener('click', () => { close(); payForm(c); });
        root.querySelectorAll('[data-sale]').forEach(tr => tr.addEventListener('click', async () => {
          try {
            const sale = await api.get('/api/sales/' + tr.dataset.sale);
            printTicket(sale, 'ticket');
          } catch (e) { notify.error(e.message); }
        }));
      },
    });
  }

  $('q').addEventListener('input', debounce(load, 300));
  $('f-type').addEventListener('change', load);
  await load();
}
