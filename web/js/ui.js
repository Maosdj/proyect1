// Utilidades de interfaz: formato, avisos, modales y formularios.

import { state } from './api.js';

/* ------------------------------------------------------------- formato */

export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function money(value, withSymbol = true) {
  const n = Number(value || 0);
  const txt = n.toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(n % 1) > 0 ? 2 : 0,
  });
  return withSymbol ? (state.settings.currency || '$') + ' ' + txt : txt;
}

export function qty(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '');
}

export function dateTime(value) {
  if (!value) return '';
  const d = new Date(String(value).replace(' ', 'T'));
  if (isNaN(d)) return value;
  return d.toLocaleString('es-CO', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export function dateOnly(value) {
  if (!value) return '';
  const d = new Date(String(value).replace(' ', 'T'));
  if (isNaN(d)) return value;
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

export function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

export function debounce(fn, ms = 280) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

/* ------------------------------------------------------------- avisos */

export function toast(message, kind = '') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 320);
  }, kind === 'error' ? 4200 : 2600);
}

export const notify = {
  ok: (m) => toast(m, 'ok'),
  error: (m) => toast(m, 'error'),
  info: (m) => toast(m),
};

/* ------------------------------------------------------------- modales */

export function openModal({ title, body, footer = '', wide = false, onMount, onClose }) {
  const root = document.getElementById('modal-root');
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h2>${esc(title)}</h2>
        <button class="icon-btn" data-close aria-label="Cerrar">✕</button>
      </div>
      <div class="modal-body"></div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  const bodyEl = back.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);

  const close = () => {
    back.remove();
    document.body.style.overflow = '';
    if (onClose) onClose();
  };
  back.addEventListener('click', (e) => {
    if (e.target === back || e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
    if (!document.body.contains(back)) document.removeEventListener('keydown', onEsc);
  });
  root.appendChild(back);
  document.body.style.overflow = 'hidden';
  if (onMount) onMount(back, close);
  const first = back.querySelector('input:not([type=hidden]), select, textarea');
  if (first && window.innerWidth > 860) first.focus();
  return close;
}

export function confirmDialog({ title = 'Confirmar', message, confirmLabel = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const close = openModal({
      title,
      body: `<p>${esc(message)}</p>`,
      footer: `<button class="btn btn-soft" data-close>Cancelar</button>
               <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmLabel)}</button>`,
      onMount: (root, closeFn) => {
        root.querySelector('[data-ok]').addEventListener('click', () => {
          answered = true; closeFn(); resolve(true);
        });
      },
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

/* --------------------------------------------------------- formularios */

function fieldHtml(f) {
  const id = 'f_' + f.name;
  const val = f.value === undefined || f.value === null ? '' : f.value;
  let control;
  if (f.type === 'select') {
    const opts = (f.options || []).map(o => {
      const value = typeof o === 'object' ? o.value : o;
      const label = typeof o === 'object' ? o.label : o;
      const sel = String(value) === String(val) ? ' selected' : '';
      return `<option value="${esc(value)}"${sel}>${esc(label)}</option>`;
    }).join('');
    control = `<select class="input" id="${id}" name="${f.name}" ${f.required ? 'required' : ''}>${opts}</select>`;
  } else if (f.type === 'textarea') {
    control = `<textarea class="input" id="${id}" name="${f.name}" placeholder="${esc(f.placeholder || '')}">${esc(val)}</textarea>`;
  } else if (f.type === 'checkbox') {
    return `<label class="check"><input type="checkbox" name="${f.name}" ${val ? 'checked' : ''}> ${esc(f.label)}</label>`;
  } else {
    const step = f.step ? ` step="${f.step}"` : (f.type === 'number' ? ' step="any"' : '');
    control = `<input class="input" id="${id}" type="${f.type || 'text'}" name="${f.name}"
      value="${esc(val)}" placeholder="${esc(f.placeholder || '')}"${step}
      ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.required ? 'required' : ''}
      ${f.autofocus ? 'autofocus' : ''} ${f.attrs || ''}>`;
  }
  return `<div class="field" ${f.full ? 'style="grid-column:1/-1"' : ''}>
      <label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>
      ${control}
      ${f.hint ? `<small>${esc(f.hint)}</small>` : ''}
    </div>`;
}

export function formModal({ title, fields, submitLabel = 'Guardar', wide = false, onSubmit, extraHtml = '' }) {
  const html = `<form id="modal-form" novalidate>
      <div class="form-grid">${fields.map(fieldHtml).join('')}</div>
      ${extraHtml}
    </form>`;
  return openModal({
    title, body: html, wide,
    footer: `<button class="btn btn-soft" data-close>Cancelar</button>
             <button class="btn btn-primary" data-submit>${esc(submitLabel)}</button>`,
    onMount: (root, close) => {
      const form = root.querySelector('#modal-form');
      const btn = root.querySelector('[data-submit]');
      const submit = async () => {
        const values = {};
        fields.forEach(f => {
          const input = form.elements[f.name];
          if (!input) return;
          if (f.type === 'checkbox') values[f.name] = input.checked;
          else if (f.type === 'number') values[f.name] = input.value === '' ? 0 : Number(input.value);
          else values[f.name] = input.value;
        });
        const missing = fields.find(f => f.required && !String(values[f.name] ?? '').trim());
        if (missing) { notify.error('Complete el campo: ' + missing.label); return; }
        btn.disabled = true;
        try {
          await onSubmit(values, close);
        } catch (e) {
          notify.error(e.message || 'No se pudo guardar');
        } finally {
          btn.disabled = false;
        }
      };
      btn.addEventListener('click', submit);
      form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    },
  });
}

/* ------------------------------------------------------------- varios */

export function badgeStock(product) {
  const s = product.stock_state || (product.stock <= 0 ? 'agotado'
    : (product.min_stock && product.stock <= product.min_stock ? 'bajo' : 'ok'));
  if (s === 'agotado') return '<span class="badge danger">Agotado</span>';
  if (s === 'bajo') return '<span class="badge warn">Stock bajo</span>';
  return '<span class="badge ok">Disponible</span>';
}

export function orderStatusBadge(status) {
  const map = {
    pendiente: ['warn', 'Pendiente'],
    aprobado: ['info', 'Aprobado'],
    listo: ['orange', 'Listo para recoger'],
    entregado: ['ok', 'Entregado'],
    cancelado: ['danger', 'Cancelado'],
  };
  const [cls, label] = map[status] || ['', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

export function payBadge(sale) {
  if (sale.status === 'anulada') return '<span class="badge danger">Anulada</span>';
  if (sale.balance > 0) return '<span class="badge warn">Fiado</span>';
  const map = { efectivo: '💵 Efectivo', tarjeta: '💳 Tarjeta', transferencia: '📱 Transferencia',
    mixto: '🔀 Mixto', credito: '📒 Credito' };
  return `<span class="badge">${map[sale.payment_type] || sale.payment_type}</span>`;
}

export function loader(text = 'Cargando...') {
  return `<div class="empty"><span class="ic">⏳</span>${esc(text)}</div>`;
}

export function emptyState(icon, title, sub = '') {
  return `<div class="empty"><span class="ic">${icon}</span>
    <strong>${esc(title)}</strong>${sub ? `<p class="small">${esc(sub)}</p>` : ''}</div>`;
}

export function setTitle(title, sub = '') {
  document.getElementById('view-title').textContent = title;
  document.getElementById('view-sub').textContent = sub;
}

export function setActions(html = '') {
  document.getElementById('topbar-actions').innerHTML = html;
}
