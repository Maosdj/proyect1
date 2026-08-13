// Proveedores y los productos que suministran.

import { api } from '../api.js';
import { esc, notify, formModal, confirmDialog, setActions, emptyState, qty as fmtQty } from '../ui.js';

export async function render(view) {
  setActions(`<button class="btn btn-primary btn-sm" id="act-new">➕ Nuevo proveedor</button>`);
  document.getElementById('act-new').addEventListener('click', () => openForm());

  view.innerHTML = `<div id="list">Cargando...</div>`;
  const list = view.querySelector('#list');

  async function load() {
    const res = await api.get('/api/suppliers');
    if (!res.items.length) {
      list.innerHTML = `<div class="card">${emptyState('🚚', 'Sin proveedores registrados')}</div>`;
      return;
    }
    list.innerHTML = `<div class="grid grid-2">${res.items.map(s => `
      <div class="card" style="margin:0">
        <div class="card-head">
          <span style="font-size:24px">🚚</span>
          <div style="flex:1">
            <h2>${esc(s.name)}</h2>
            <p class="small muted">${esc(s.contact || 'Sin contacto')} ${s.phone ? '· 📞 ' + esc(s.phone) : ''}</p>
          </div>
        </div>
        <p class="small">${s.email ? '✉️ ' + esc(s.email) + '<br>' : ''}
           ${s.address ? '📍 ' + esc(s.address) : ''}</p>
        ${s.notes ? `<p class="small muted">${esc(s.notes)}</p>` : ''}
        <p class="small strong" style="margin-top:8px">${s.product_count} productos que suministra</p>
        ${s.products.length ? `<div class="small muted" style="max-height:110px;overflow:auto">
          ${s.products.map(p => `<div>• ${esc(p.name)} <span class="muted">(${fmtQty(p.stock)} ${esc(p.unit)})</span></div>`).join('')}
        </div>` : ''}
        <div class="row" style="margin-top:12px">
          <button class="btn btn-sm btn-soft" data-edit="${s.id}">✏️ Editar</button>
          <button class="btn btn-sm btn-soft" data-del="${s.id}">🗑️</button>
        </div>
      </div>`).join('')}</div>`;

    list.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () =>
      openForm(res.items.find(s => s.id === Number(b.dataset.edit)))));
    list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () =>
      remove(res.items.find(s => s.id === Number(b.dataset.del)))));
  }

  function openForm(sup) {
    const s = sup || {};
    formModal({
      title: sup ? 'Editar proveedor' : 'Nuevo proveedor',
      fields: [
        { name: 'name', label: 'Nombre / empresa', value: s.name, required: true, full: true },
        { name: 'contact', label: 'Persona de contacto', value: s.contact },
        { name: 'phone', label: 'Telefono', value: s.phone },
        { name: 'email', label: 'Correo', value: s.email },
        { name: 'address', label: 'Direccion', value: s.address },
        { name: 'notes', label: 'Notas (que productos surte, condiciones)', type: 'textarea',
          value: s.notes, full: true },
      ],
      onSubmit: async (values, close) => {
        if (sup) await api.put('/api/suppliers/' + sup.id, values);
        else await api.post('/api/suppliers', values);
        notify.ok('Proveedor guardado');
        close();
        load();
      },
    });
  }

  async function remove(sup) {
    const ok = await confirmDialog({
      title: 'Eliminar proveedor', danger: true, confirmLabel: 'Eliminar',
      message: `¿Eliminar "${sup.name}"?`,
    });
    if (!ok) return;
    try {
      await api.del('/api/suppliers/' + sup.id);
      notify.ok('Proveedor eliminado');
      load();
    } catch (e) { notify.error(e.message); }
  }

  await load();
}
