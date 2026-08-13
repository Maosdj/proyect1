// Perfil del cliente: datos de contacto y contrasena.

import { api, state, loadBootstrap } from '../api.js';
import { esc, money, notify, setActions } from '../ui.js';
import { renderNav } from '../app.js';

export async function render(view) {
  setActions('');
  const summary = await api.get('/api/me/summary');
  const c = summary.customer;

  view.innerHTML = `
    <div class="grid grid-3" style="margin-bottom:16px">
      <div class="stat"><h3>Compras realizadas</h3><div class="value">${summary.purchases}</div></div>
      <div class="stat earth"><h3>Total comprado</h3><div class="value">${money(summary.spent)}</div></div>
      <div class="stat ${summary.pending_credit > 0 ? 'red' : ''}"><h3>Saldo pendiente</h3>
        <div class="value">${money(summary.pending_credit)}</div>
        <div class="sub">${summary.open_orders} pedidos abiertos</div></div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h2>👤 Mis datos</h2></div>
        <form id="profile">
          <div class="field"><label>Nombre o razon social</label>
            <input class="input" name="name" value="${esc(c.name)}" required></div>
          <div class="form-grid">
            <div class="field"><label>Cedula / NIT</label>
              <input class="input" name="doc" value="${esc(c.doc || '')}"></div>
            <div class="field"><label>Telefono</label>
              <input class="input" name="phone" value="${esc(c.phone || '')}"></div>
            <div class="field"><label>Tipo</label>
              <select class="input" name="type">
                <option value="particular" ${c.type === 'particular' ? 'selected' : ''}>Particular</option>
                <option value="finca" ${c.type === 'finca' ? 'selected' : ''}>Finca / Empresa</option>
              </select></div>
            <div class="field"><label>Nombre de finca / negocio</label>
              <input class="input" name="farm_name" value="${esc(c.farm_name || '')}"></div>
          </div>
          <div class="field"><label>Direccion</label>
            <input class="input" name="address" value="${esc(c.address || '')}"></div>
          <button class="btn btn-primary" type="submit">Guardar cambios</button>
        </form>
      </div>

      <div class="card">
        <div class="card-head"><h2>🔐 Seguridad</h2></div>
        <p class="small muted" style="margin-bottom:12px">Correo de acceso: <b>${esc(state.user.email)}</b></p>
        <form id="pass">
          <div class="field"><label>Contrasena actual</label>
            <input class="input" type="password" name="current" required></div>
          <div class="field"><label>Nueva contrasena</label>
            <input class="input" type="password" name="new" required></div>
          <button class="btn btn-green" type="submit">Cambiar contrasena</button>
        </form>
      </div>
    </div>`;

  view.querySelector('#profile').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.put('/api/me/profile', Object.fromEntries(new FormData(e.target).entries()));
      await loadBootstrap();
      renderNav();
      notify.ok('Datos actualizados');
    } catch (err) { notify.error(err.message); }
  });

  view.querySelector('#pass').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/auth/password', Object.fromEntries(new FormData(e.target).entries()));
      notify.ok('Contrasena actualizada');
      e.target.reset();
    } catch (err) { notify.error(err.message); }
  });
}
