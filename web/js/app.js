// Shell de la aplicacion: arranque, navegacion y control de acceso por rol.

import { state, loadBootstrap, api, setToken } from './api.js';
import { esc, initials, notify, setTitle, setActions, loader } from './ui.js';
import { cartCount } from './cart.js';

const ROUTES = [
  // --- Modulo Ferreteria / Administracion
  { path: 'dashboard', title: 'Dashboard', sub: 'Resumen del negocio', icon: '📊',
    roles: ['admin'], group: 'Administracion', load: () => import('./views/dashboard.js') },
  { path: 'pos', short: 'Vender', title: 'Punto de venta', sub: 'Registrar una venta', icon: '🧾',
    roles: ['admin', 'cajero'], group: 'Venta', bottom: 1, load: () => import('./views/pos.js') },
  { path: 'orders', short: 'Pedidos', title: 'Pedidos y cotizaciones', sub: 'Solicitudes de clientes', icon: '📥',
    roles: ['admin', 'cajero'], group: 'Venta', bottom: 2, badge: 'orders',
    load: () => import('./views/orders.js') },
  { path: 'sales', title: 'Historial de ventas', sub: 'Ventas registradas', icon: '📜',
    roles: ['admin', 'cajero'], group: 'Venta', load: () => import('./views/sales.js') },
  { path: 'cash', title: 'Caja', sub: 'Apertura, movimientos y cierre', icon: '💰',
    roles: ['admin', 'cajero'], group: 'Venta', load: () => import('./views/cash.js') },

  { path: 'products', short: 'Inventario', title: 'Inventario', sub: 'Productos y existencias', icon: '📦',
    roles: ['admin', 'cajero'], group: 'Inventario', bottom: 3, badge: 'stock',
    load: () => import('./views/products.js') },
  { path: 'moves', title: 'Movimientos de inventario', sub: 'Entradas, salidas y ajustes', icon: '🔁',
    roles: ['admin', 'cajero'], group: 'Inventario', load: () => import('./views/moves.js') },
  { path: 'categories', title: 'Categorias', sub: 'Organizacion del catalogo', icon: '🗂️',
    roles: ['admin'], group: 'Inventario', load: () => import('./views/categories.js') },
  { path: 'suppliers', title: 'Proveedores', sub: 'Quien nos surte', icon: '🚚',
    roles: ['admin'], group: 'Inventario', load: () => import('./views/suppliers.js') },

  { path: 'customers', short: 'Clientes', title: 'Clientes', sub: 'Fichas e historial de compras', icon: '👥',
    roles: ['admin', 'cajero'], group: 'Clientes', bottom: 4,
    load: () => import('./views/customers.js') },
  { path: 'credits', title: 'Creditos y fiados', sub: 'Saldos pendientes y abonos', icon: '📒',
    roles: ['admin', 'cajero'], group: 'Clientes', load: () => import('./views/credits.js') },

  { path: 'reports', title: 'Reportes', sub: 'Ventas, ganancias e inventario', icon: '📈',
    roles: ['admin'], group: 'Administracion', load: () => import('./views/reports.js') },
  { path: 'users', title: 'Usuarios', sub: 'Cajeros y permisos', icon: '🔑',
    roles: ['admin'], group: 'Administracion', load: () => import('./views/users.js') },
  { path: 'settings', title: 'Ajustes', sub: 'Datos del negocio', icon: '⚙️',
    roles: ['admin'], group: 'Administracion', load: () => import('./views/settings.js') },

  // --- Modulo Cliente
  { path: 'catalog', short: 'Catalogo', title: 'Catalogo', sub: 'Insumos agricolas y ferreteria', icon: '🛒',
    roles: ['cliente'], group: 'Tienda', bottom: 1, load: () => import('./views/catalog.js') },
  { path: 'cart', short: 'Mi pedido', title: 'Mi pedido', sub: 'Productos seleccionados', icon: '🧺',
    roles: ['cliente'], group: 'Tienda', bottom: 2, badge: 'cart',
    load: () => import('./views/cart.js') },
  { path: 'myorders', short: 'Pedidos', title: 'Mis pedidos', sub: 'Pedidos y cotizaciones', icon: '📦',
    roles: ['cliente'], group: 'Mi cuenta', bottom: 3, load: () => import('./views/myorders.js') },
  { path: 'mycredit', short: 'Credito', title: 'Mi credito', sub: 'Saldo y compras', icon: '📒',
    roles: ['cliente'], group: 'Mi cuenta', bottom: 4, load: () => import('./views/mycredit.js') },
  { path: 'profile', title: 'Mi perfil', sub: 'Datos de contacto', icon: '👤',
    roles: ['cliente'], group: 'Mi cuenta', load: () => import('./views/profile.js') },
];

const GROUP_ORDER = ['Venta', 'Inventario', 'Clientes', 'Administracion', 'Tienda', 'Mi cuenta'];

export function routesFor(role) {
  return ROUTES.filter(r => r.roles.includes(role));
}

function homeFor(role) {
  if (role === 'admin') return 'dashboard';
  if (role === 'cajero') return 'pos';
  return 'catalog';
}

function badgeValue(kind) {
  if (kind === 'orders') return state.pendingOrders;
  if (kind === 'stock') return state.alerts;
  if (kind === 'cart') return cartCount();
  return 0;
}

/* ------------------------------------------------------------ navegacion */

export function renderNav() {
  const user = state.user;
  if (!user) return;
  const routes = routesFor(user.role);
  const current = currentPath();
  const groups = {};
  routes.forEach(r => { (groups[r.group] = groups[r.group] || []).push(r); });

  const nav = document.getElementById('nav');
  nav.innerHTML = GROUP_ORDER.filter(g => groups[g]).map(g => `
    <div class="nav-group">${esc(g)}</div>
    ${groups[g].map(r => {
      const n = r.badge ? badgeValue(r.badge) : 0;
      return `<a href="#/${r.path}" class="${current === r.path ? 'active' : ''}">
        <span class="ic">${r.icon}</span><span>${esc(r.title)}</span>
        ${n ? `<span class="pill">${n}</span>` : ''}</a>`;
    }).join('')}`).join('');

  const bottom = routes.filter(r => r.bottom).sort((a, b) => a.bottom - b.bottom).slice(0, 4);
  document.getElementById('bottom-nav').innerHTML = bottom.map(r => {
    const n = r.badge ? badgeValue(r.badge) : 0;
    return `<a href="#/${r.path}" class="${current === r.path ? 'active' : ''}">
      <span class="ic">${r.icon}</span>${n ? '<span class="dot"></span>' : ''}
      <span>${esc(r.short || r.title)}</span></a>`;
  }).join('') + `<button data-action="toggle-menu"><span class="ic">☰</span><span>Menu</span></button>`;

  document.getElementById('user-name').textContent = user.name;
  document.getElementById('user-role').textContent =
    user.role === 'admin' ? 'Administrador' : (user.role === 'cajero' ? 'Cajero / Vendedor' : 'Cliente');
  document.getElementById('user-avatar').textContent = initials(user.name);
  document.getElementById('brand-name').textContent = state.settings.business_short || 'AgroFerre';
}

function currentPath() {
  const hash = location.hash.replace(/^#\/?/, '');
  return hash.split('?')[0] || '';
}

function currentQuery() {
  const hash = location.hash;
  const i = hash.indexOf('?');
  return i === -1 ? {} : Object.fromEntries(new URLSearchParams(hash.slice(i + 1)));
}

let currentCleanup = null;

export async function navigate() {
  if (!state.user) return showAuth();

  const path = currentPath() || homeFor(state.user.role);
  if (!location.hash) { location.hash = '#/' + path; return; }

  const route = ROUTES.find(r => r.path === path);
  const view = document.getElementById('view');

  if (!route) {
    setTitle('Pagina no encontrada', '');
    setActions('');
    view.innerHTML = `<div class="card"><div class="empty"><span class="ic">🧭</span>
      <strong>Esa seccion no existe</strong>
      <p class="small">Use el menu para navegar.</p></div></div>`;
    return;
  }
  if (!route.roles.includes(state.user.role)) {
    notify.error('No tiene permisos para entrar a ' + route.title);
    location.hash = '#/' + homeFor(state.user.role);
    return;
  }

  if (currentCleanup) { try { currentCleanup(); } catch (e) { /* noop */ } currentCleanup = null; }
  closeMenu();
  setTitle(route.title, route.sub);
  setActions('');
  view.innerHTML = loader();
  window.scrollTo(0, 0);
  renderNav();

  try {
    const mod = await route.load();
    const cleanup = await mod.render(view, currentQuery());
    if (typeof cleanup === 'function') currentCleanup = cleanup;
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card"><div class="empty"><span class="ic">⚠️</span>
      <strong>No se pudo cargar la seccion</strong>
      <p class="small">${esc(e.message || '')}</p></div></div>`;
  }
  renderNav();
}

export function refreshBadges() {
  loadBootstrap().then(renderNav).catch(() => {});
}

/* ---------------------------------------------------------------- menu */

function openMenu() { document.body.classList.add('menu-open'); document.getElementById('scrim').hidden = false; }
function closeMenu() { document.body.classList.remove('menu-open'); document.getElementById('scrim').hidden = true; }

document.addEventListener('click', (e) => {
  const trigger = e.target.closest('[data-action]');
  if (!trigger) return;
  const action = trigger.dataset.action;
  if (action === 'toggle-menu') {
    document.body.classList.contains('menu-open') ? closeMenu() : openMenu();
  } else if (action === 'logout') {
    doLogout();
  }
});
document.getElementById('scrim').addEventListener('click', closeMenu);

async function doLogout() {
  try { await api.post('/api/auth/logout'); } catch (e) { /* la sesion local igual se limpia */ }
  setToken('');
  state.user = null;
  location.hash = '#/login';
  showAuth();
}

/* -------------------------------------------------------------- arranque */

export async function showAuth() {
  const mod = await import('./views/login.js');
  document.getElementById('app').hidden = true;
  document.getElementById('boot').hidden = true;
  let host = document.getElementById('auth-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'auth-host';
    document.body.appendChild(host);
  }
  host.hidden = false;
  mod.render(host, onAuthSuccess);
}

export async function onAuthSuccess() {
  await loadBootstrap();
  const host = document.getElementById('auth-host');
  if (host) host.remove();
  document.getElementById('app').hidden = false;
  document.getElementById('boot').hidden = true;
  const path = currentPath();
  const allowed = routesFor(state.user.role).some(r => r.path === path);
  if (!allowed) location.hash = '#/' + homeFor(state.user.role);
  renderNav();
  navigate();
}

window.addEventListener('hashchange', navigate);

(async function boot() {
  try {
    await loadBootstrap();
  } catch (e) {
    document.getElementById('boot').innerHTML =
      '<p>No se pudo conectar con el servidor.<br><small>' + esc(e.message) + '</small></p>';
    return;
  }
  if (!state.user) {
    showAuth();
  } else {
    document.getElementById('app').hidden = false;
    document.getElementById('boot').hidden = true;
    renderNav();
    navigate();
  }
})();
