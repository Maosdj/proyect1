// Cliente HTTP y estado de sesion compartido.

const TOKEN_KEY = 'agroferre_token';

export const state = {
  user: null,
  settings: {},
  categories: [],
  alerts: 0,
  pendingOrders: 0,
  cashOpen: false,
};

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body, query) {
  let url = path;
  if (query) {
    const qs = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.append(k, v);
    });
    const s = qs.toString();
    if (s) url += '?' + s;
  }
  const headers = {};
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError('Sin conexion con el servidor', 0);
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch (e) { data = null; }
  }
  if (!res.ok) {
    const msg = (data && data.error) || 'Error ' + res.status;
    if (res.status === 401 && token) {
      setToken('');
      state.user = null;
      if (!location.hash.startsWith('#/login')) location.hash = '#/login';
    }
    throw new ApiError(msg, res.status);
  }
  return data;
}

export const api = {
  get: (path, query) => request('GET', path, undefined, query),
  post: (path, body) => request('POST', path, body || {}),
  put: (path, body) => request('PUT', path, body || {}),
  del: (path) => request('DELETE', path),
};

export async function loadBootstrap() {
  const data = await api.get('/api/bootstrap');
  state.settings = data.settings || {};
  state.categories = data.categories || [];
  state.user = data.user || null;
  state.alerts = data.alerts || 0;
  state.pendingOrders = data.pending_orders || 0;
  state.cashOpen = !!data.cash_open;
  return data;
}
