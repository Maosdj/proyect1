// Ajustes del negocio y cambio de contrasena.

import { api, state, loadBootstrap } from '../api.js';
import { esc, notify, setActions } from '../ui.js';
import { renderNav } from '../app.js';

export async function render(view) {
  setActions('');
  const s = await api.get('/api/settings');

  view.innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h2>🏪 Datos del negocio</h2></div>
        <p class="small muted" style="margin-bottom:12px">Aparecen en los tickets y facturas.</p>
        <form id="biz">
          <div class="field"><label>Nombre del negocio</label>
            <input class="input" name="business_name" value="${esc(s.business_name || '')}"></div>
          <div class="form-grid">
            <div class="field"><label>Nombre corto (menu)</label>
              <input class="input" name="business_short" value="${esc(s.business_short || '')}"></div>
            <div class="field"><label>NIT / documento</label>
              <input class="input" name="nit" value="${esc(s.nit || '')}"></div>
            <div class="field"><label>Telefono</label>
              <input class="input" name="phone" value="${esc(s.phone || '')}"></div>
            <div class="field"><label>Simbolo de moneda</label>
              <input class="input" name="currency" value="${esc(s.currency || '$')}"></div>
          </div>
          <div class="field"><label>Direccion</label>
            <input class="input" name="address" value="${esc(s.address || '')}"></div>
          <div class="field"><label>Mensaje al pie del ticket</label>
            <textarea class="input" name="ticket_footer">${esc(s.ticket_footer || '')}</textarea></div>
          <button class="btn btn-primary" type="submit">Guardar cambios</button>
        </form>
      </div>

      <div class="card">
        <div class="card-head"><h2>🔐 Mi contrasena</h2></div>
        <form id="pass">
          <div class="field"><label>Contrasena actual</label>
            <input class="input" type="password" name="current" required></div>
          <div class="field"><label>Nueva contrasena</label>
            <input class="input" type="password" name="new" required></div>
          <button class="btn btn-green" type="submit">Cambiar contrasena</button>
        </form>

        <div class="card-head" style="margin-top:24px"><h2>ℹ️ Sistema</h2></div>
        <div class="list-item"><span class="li-ic">👤</span>
          <span class="li-body"><strong>${esc(state.user.name)}</strong>
            <small>${esc(state.user.email)} · ${esc(state.user.role)}</small></span></div>
        <div class="list-item"><span class="li-ic">💾</span>
          <span class="li-body"><strong>Base de datos SQLite local</strong>
            <small>data/pos.db — respalde este archivo periodicamente</small></span></div>
        <div class="list-item"><span class="li-ic">📱</span>
          <span class="li-body"><strong>Uso en celular</strong>
            <small>Abra la IP que muestra el servidor desde la misma red WiFi</small></span></div>
      </div>
    </div>`;

  view.querySelector('#biz').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api.put('/api/settings', data);
      await loadBootstrap();
      renderNav();
      notify.ok('Datos del negocio actualizados');
    } catch (err) { notify.error(err.message); }
  });

  view.querySelector('#pass').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api.post('/api/auth/password', data);
      notify.ok('Contrasena actualizada');
      e.target.reset();
    } catch (err) { notify.error(err.message); }
  });
}
