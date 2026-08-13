// Gestion de usuarios: administradores, cajeros y cuentas de cliente.

import { api, state } from '../api.js';
import {
  esc, notify, formModal, confirmDialog, setActions, emptyState, dateOnly,
} from '../ui.js';

const ROLE_INFO = {
  admin: ['👑', 'Administrador', 'Acceso total: precios, inventario, reportes y usuarios'],
  cajero: ['🧾', 'Cajero / Vendedor', 'Vende, cobra, abre y cierra caja. No edita precios ni borra productos'],
  cliente: ['🛒', 'Cliente', 'Solo catalogo, pedidos y su propio credito'],
};

export async function render(view) {
  setActions(`<button class="btn btn-primary btn-sm" id="act-new">➕ Nuevo usuario</button>`);
  document.getElementById('act-new').addEventListener('click', () => openForm());

  view.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>Permisos por rol</h2></div>
      <div class="grid grid-3">
        ${Object.entries(ROLE_INFO).map(([, [icon, name, desc]]) => `
          <div class="card card-flat" style="margin:0;background:#fbfaf7">
            <strong>${icon} ${name}</strong>
            <p class="small muted">${desc}</p>
          </div>`).join('')}
      </div>
    </div>
    <div class="card"><div id="list">Cargando...</div></div>`;

  const list = view.querySelector('#list');
  let customers = [];

  async function load() {
    const res = await api.get('/api/users');
    if (!res.items.length) { list.innerHTML = emptyState('🔑', 'Sin usuarios'); return; }
    list.innerHTML = `
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Usuario</th><th>Correo</th><th>Rol</th><th class="num">Ventas</th>
          <th>Estado</th><th>Creado</th><th></th></tr></thead>
        <tbody>${res.items.map(u => `<tr>
          <td><strong>${ROLE_INFO[u.role][0]} ${esc(u.name)}</strong>
            ${u.customer_name ? `<br><span class="small muted">Cliente: ${esc(u.customer_name)}</span>` : ''}
            ${u.phone ? `<br><span class="small muted">📞 ${esc(u.phone)}</span>` : ''}</td>
          <td class="small">${esc(u.email)}</td>
          <td><span class="badge ${u.role === 'admin' ? 'orange' : (u.role === 'cajero' ? 'info' : '')}">
            ${ROLE_INFO[u.role][1]}</span></td>
          <td class="num">${u.sales_count}</td>
          <td>${u.active ? '<span class="badge ok">Activo</span>' : '<span class="badge danger">Inactivo</span>'}</td>
          <td class="small muted">${dateOnly(u.created_at)}</td>
          <td><div class="actions">
            <button class="btn btn-sm btn-soft" data-edit="${u.id}">✏️</button>
            ${u.id === state.user.id ? '' : `<button class="btn btn-sm btn-soft" data-del="${u.id}">🗑️</button>`}
          </div></td>
        </tr>`).join('')}</tbody>
      </table></div>`;

    list.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () =>
      openForm(res.items.find(u => u.id === Number(b.dataset.edit)))));
    list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () =>
      remove(res.items.find(u => u.id === Number(b.dataset.del)))));
  }

  async function openForm(user) {
    if (!customers.length) {
      try { customers = (await api.get('/api/customers', { limit: 300 })).items; } catch (e) { customers = []; }
    }
    const u = user || {};
    formModal({
      title: user ? 'Editar usuario' : 'Nuevo usuario',
      submitLabel: user ? 'Guardar cambios' : 'Crear usuario',
      fields: [
        { name: 'name', label: 'Nombre completo', value: u.name, required: true, full: true },
        { name: 'email', label: 'Correo (usuario)', value: u.email, required: true, type: 'email' },
        { name: 'phone', label: 'Telefono', value: u.phone },
        { name: 'role', label: 'Rol', type: 'select', value: u.role || 'cajero',
          options: [{ value: 'admin', label: '👑 Administrador' },
            { value: 'cajero', label: '🧾 Cajero / Vendedor' },
            { value: 'cliente', label: '🛒 Cliente' }] },
        { name: 'customer_id', label: 'Ficha de cliente (solo rol cliente)', type: 'select',
          value: u.customer_id || '',
          options: [{ value: '', label: '— Ninguna —' }].concat(
            customers.map(c => ({ value: c.id, label: c.name }))) },
        { name: 'password', label: user ? 'Nueva contrasena (opcional)' : 'Contrasena', type: 'password',
          required: !user, full: true, hint: 'Minimo 6 caracteres' },
        { name: 'active', label: 'Usuario activo', type: 'checkbox', value: user ? !!u.active : true },
      ],
      onSubmit: async (values, close) => {
        if (user && !values.password) delete values.password;
        if (user) await api.put('/api/users/' + user.id, values);
        else await api.post('/api/users', values);
        notify.ok('Usuario guardado');
        close();
        load();
      },
    });
  }

  async function remove(u) {
    const ok = await confirmDialog({
      title: 'Eliminar usuario', danger: true, confirmLabel: 'Eliminar',
      message: `¿Eliminar a "${u.name}"? Si tiene ventas registradas se desactivara.`,
    });
    if (!ok) return;
    try {
      const res = await api.del('/api/users/' + u.id);
      notify.ok(res.message || 'Usuario eliminado');
      load();
    } catch (e) { notify.error(e.message); }
  }

  await load();
}
