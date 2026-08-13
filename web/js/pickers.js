// Selectores reutilizables (clientes, productos).

import { api } from './api.js';
import { esc, money, openModal, notify, debounce, formModal } from './ui.js';

export function pickCustomer({ allowNone = true, title = 'Seleccionar cliente' } = {}) {
  return new Promise((resolve) => {
    let resolved = false;
    const close = openModal({
      title,
      body: `
        <div class="search-wrap" style="margin-bottom:12px">
          <input class="input" id="cust-search" placeholder="Buscar por nombre, telefono o cedula" autocomplete="off">
        </div>
        ${allowNone ? `<button class="btn btn-soft btn-block" data-none style="margin-bottom:10px">
          👤 Consumidor final (sin registrar)</button>` : ''}
        <button class="btn btn-green btn-block" data-new style="margin-bottom:12px">➕ Cliente nuevo</button>
        <div id="cust-list">Cargando...</div>`,
      onMount: (root, closeFn) => {
        const list = root.querySelector('#cust-list');
        const input = root.querySelector('#cust-search');

        const pick = (customer) => { resolved = true; closeFn(); resolve(customer); };

        const load = async (q) => {
          list.innerHTML = '<p class="muted small">Buscando...</p>';
          try {
            const res = await api.get('/api/customers', { q, limit: 30 });
            if (!res.items.length) {
              list.innerHTML = '<p class="muted small">Sin resultados.</p>';
              return;
            }
            list.innerHTML = res.items.map(c => `
              <div class="list-item clickable" data-id="${c.id}">
                <span class="li-ic">${c.type === 'finca' ? '🌾' : '👤'}</span>
                <span class="li-body">
                  <strong>${esc(c.name)}</strong>
                  <small>${esc(c.phone || 'Sin telefono')}${c.farm_name ? ' · ' + esc(c.farm_name) : ''}</small>
                </span>
                ${c.pending > 0 ? `<span class="badge warn">Debe ${money(c.pending)}</span>` : ''}
              </div>`).join('');
            list.querySelectorAll('[data-id]').forEach(row => {
              row.addEventListener('click', () => {
                pick(res.items.find(c => c.id === Number(row.dataset.id)));
              });
            });
          } catch (e) {
            list.innerHTML = `<p class="danger-text small">${esc(e.message)}</p>`;
          }
        };

        input.addEventListener('input', debounce(() => load(input.value.trim())));
        if (allowNone) root.querySelector('[data-none]').addEventListener('click', () => pick(null));
        root.querySelector('[data-new]').addEventListener('click', () => {
          newCustomerForm((created) => { pick(created); });
        });
        load('');
      },
      onClose: () => { if (!resolved) resolve(undefined); },
    });
  });
}

export function newCustomerForm(onCreated) {
  formModal({
    title: 'Nuevo cliente',
    fields: [
      { name: 'name', label: 'Nombre o razon social', required: true, full: true },
      { name: 'doc', label: 'Cedula / NIT' },
      { name: 'phone', label: 'Telefono' },
      { name: 'type', label: 'Tipo', type: 'select',
        options: [{ value: 'particular', label: 'Particular' }, { value: 'finca', label: 'Finca / Empresa' }] },
      { name: 'farm_name', label: 'Nombre de finca / negocio' },
      { name: 'address', label: 'Direccion', full: true },
      { name: 'credit_limit', label: 'Cupo de credito', type: 'number', min: 0,
        hint: 'Deje 0 si no maneja fiado' },
    ],
    submitLabel: 'Crear cliente',
    onSubmit: async (values, close) => {
      const created = await api.post('/api/customers', values);
      notify.ok('Cliente creado');
      close();
      if (onCreated) onCreated(created);
    },
  });
}
