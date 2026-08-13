// Categorias del catalogo.

import { api, state, loadBootstrap } from '../api.js';
import { esc, notify, formModal, confirmDialog, setActions, emptyState } from '../ui.js';

export async function render(view) {
  setActions(`<button class="btn btn-primary btn-sm" id="act-new">➕ Nueva categoria</button>`);
  document.getElementById('act-new').addEventListener('click', () => openForm());

  view.innerHTML = `<div class="card"><div id="list">Cargando...</div></div>`;
  const list = view.querySelector('#list');

  async function load() {
    const res = await api.get('/api/categories');
    await loadBootstrap();
    if (!res.items.length) { list.innerHTML = emptyState('🗂️', 'Sin categorias'); return; }
    list.innerHTML = `<div class="grid grid-3">${res.items.map(c => `
      <div class="card card-flat" style="margin:0;border-left:4px solid ${esc(c.color || '#8b5e34')}">
        <div class="row">
          <span style="font-size:26px">${c.icon || '📦'}</span>
          <div style="flex:1">
            <strong>${esc(c.name)}</strong>
            <p class="small muted">${c.product_count} productos</p>
          </div>
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn btn-sm btn-soft" data-edit="${c.id}">✏️ Editar</button>
          <button class="btn btn-sm btn-soft" data-del="${c.id}">🗑️</button>
        </div>
      </div>`).join('')}</div>`;

    list.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () =>
      openForm(res.items.find(c => c.id === Number(b.dataset.edit)))));
    list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () =>
      remove(res.items.find(c => c.id === Number(b.dataset.del)))));
  }

  function openForm(cat) {
    const c = cat || {};
    formModal({
      title: cat ? 'Editar categoria' : 'Nueva categoria',
      fields: [
        { name: 'name', label: 'Nombre', value: c.name, required: true, full: true },
        { name: 'icon', label: 'Icono (emoji)', value: c.icon || '📦' },
        { name: 'color', label: 'Color', type: 'color', value: c.color || '#8b5e34' },
      ],
      onSubmit: async (values, close) => {
        if (cat) await api.put('/api/categories/' + cat.id, values);
        else await api.post('/api/categories', values);
        notify.ok('Categoria guardada');
        close();
        load();
      },
    });
  }

  async function remove(cat) {
    const ok = await confirmDialog({
      title: 'Eliminar categoria', danger: true, confirmLabel: 'Eliminar',
      message: `¿Eliminar "${cat.name}"? Solo se puede si no tiene productos.`,
    });
    if (!ok) return;
    try {
      await api.del('/api/categories/' + cat.id);
      notify.ok('Categoria eliminada');
      load();
    } catch (e) { notify.error(e.message); }
  }

  await load();
}
