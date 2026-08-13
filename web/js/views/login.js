// Pantalla de acceso y registro de clientes.

import { api, setToken } from '../api.js';
import { esc, notify } from '../ui.js';

export function render(host, onSuccess) {
  let mode = 'login';

  const draw = () => {
    host.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-art">
        <div style="font-size:44px">🌾🔧</div>
        <h1>Insumos agricolas<br>y ferreteria</h1>
        <p>Sistema de punto de venta, inventario, creditos y catalogo en linea para su negocio.</p>
        <div class="feat"><span>🧾</span><span>POS rapido con lector de codigo de barras</span></div>
        <div class="feat"><span>📦</span><span>Inventario con alertas de stock bajo</span></div>
        <div class="feat"><span>📒</span><span>Control de fiados y abonos por cliente</span></div>
        <div class="feat"><span>🛒</span><span>Catalogo y pedidos para sus clientes</span></div>
      </div>
      <div class="auth-form">
        <div class="auth-box">
          <div class="logo">🌾</div>
          <h1 style="font-size:24px">${mode === 'login' ? 'Iniciar sesion' : 'Crear cuenta de cliente'}</h1>
          <p class="muted small" style="margin-bottom:18px">
            ${mode === 'login' ? 'Ingrese sus datos para continuar'
              : 'Registrese para ver el catalogo y hacer pedidos'}</p>
          <form id="auth-form">
            ${mode === 'registro' ? `
              <div class="field"><label>Nombre completo o finca *</label>
                <input class="input" name="name" required></div>
              <div class="field"><label>Telefono</label><input class="input" name="phone"></div>
              <div class="field"><label>Tipo de cliente</label>
                <select class="input" name="type">
                  <option value="particular">Particular</option>
                  <option value="finca">Finca / Empresa</option>
                </select></div>` : ''}
            <div class="field"><label>Correo electronico *</label>
              <input class="input" type="email" name="email" required autocomplete="username"></div>
            <div class="field"><label>Contrasena *</label>
              <input class="input" type="password" name="password" required
                     autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></div>
            <button class="btn btn-primary btn-block btn-lg" type="submit" id="submit-btn">
              ${mode === 'login' ? 'Entrar' : 'Crear cuenta'}</button>
          </form>
          <p class="small" style="margin-top:14px;text-align:center">
            ${mode === 'login' ? '¿Es cliente nuevo?' : '¿Ya tiene cuenta?'}
            <button class="btn btn-sm btn-soft" id="switch-mode" style="margin-left:6px">
              ${mode === 'login' ? 'Registrarse' : 'Iniciar sesion'}</button>
          </p>
          ${mode === 'login' ? `
          <div class="demo-users">
            <b>Usuarios de prueba (clic para llenar)</b>
            <button data-demo="admin@agroferre.com|admin123">👑 admin@agroferre.com / admin123</button><br>
            <button data-demo="cajero@agroferre.com|cajero123">🧾 cajero@agroferre.com / cajero123</button><br>
            <button data-demo="cliente@correo.com|cliente123">🛒 cliente@correo.com / cliente123</button>
          </div>` : ''}
        </div>
      </div>
    </div>`;

    const form = host.querySelector('#auth-form');
    const btn = host.querySelector('#submit-btn');

    host.querySelector('#switch-mode').addEventListener('click', () => {
      mode = mode === 'login' ? 'registro' : 'login';
      draw();
    });

    host.querySelectorAll('[data-demo]').forEach(b => {
      b.addEventListener('click', () => {
        const [email, pass] = b.dataset.demo.split('|');
        form.elements.email.value = email;
        form.elements.password.value = pass;
        form.elements.password.focus();
      });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      btn.disabled = true;
      btn.textContent = 'Un momento...';
      try {
        const url = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
        const res = await api.post(url, data);
        setToken(res.token);
        notify.ok('Bienvenido, ' + res.user.name);
        await onSuccess();
      } catch (err) {
        notify.error(err.message);
        btn.disabled = false;
        btn.textContent = mode === 'login' ? 'Entrar' : 'Crear cuenta';
      }
    });
  };

  draw();
}
