// Caja: apertura, movimientos de efectivo, cierre con conteo e historial de turnos.

import { api } from '../api.js';
import {
  esc, money, notify, openModal, formModal, setActions, emptyState, dateTime,
} from '../ui.js';

export async function render(view) {
  setActions('');
  view.innerHTML = `<div id="body">Cargando...</div>`;
  const body = view.querySelector('#body');

  async function load() {
    const [current, history] = await Promise.all([
      api.get('/api/cash/current'),
      api.get('/api/cash/sessions'),
    ]);
    const s = current.session;

    body.innerHTML = `
      ${s ? openHtml(s) : closedHtml()}
      <div class="card">
        <div class="card-head"><h2>🗄️ Turnos anteriores</h2></div>
        ${history.items.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Apertura</th><th>Cierre</th><th>Responsable</th><th class="num">Base</th>
            <th class="num">Esperado</th><th class="num">Contado</th><th class="num">Diferencia</th></tr></thead>
          <tbody>${history.items.map(h => `<tr>
            <td class="small nowrap">${dateTime(h.opened_at)}</td>
            <td class="small nowrap">${h.closed_at ? dateTime(h.closed_at) : '<span class="badge ok">Abierta</span>'}</td>
            <td class="small">${esc(h.opened_by_name || '')}</td>
            <td class="num">${money(h.opening_amount)}</td>
            <td class="num">${h.expected_amount != null ? money(h.expected_amount) : '—'}</td>
            <td class="num">${h.counted_amount != null ? money(h.counted_amount) : '—'}</td>
            <td class="num ${h.difference ? (h.difference < 0 ? 'danger-text' : 'ok-text') : ''}">
              ${h.difference != null ? money(h.difference) : '—'}</td>
          </tr>`).join('')}</tbody></table></div>`
          : emptyState('🗄️', 'Aun no hay turnos cerrados')}
      </div>`;

    if (s) {
      body.querySelector('#btn-mov-in').addEventListener('click', () => movementForm('ingreso'));
      body.querySelector('#btn-mov-out').addEventListener('click', () => movementForm('egreso'));
      body.querySelector('#btn-close').addEventListener('click', () => closeForm(s));
    } else {
      body.querySelector('#btn-open').addEventListener('click', openForm);
    }
  }

  function openHtml(s) {
    const m = s.summary;
    return `
      <div class="card" style="border-left:4px solid var(--ok)">
        <div class="card-head">
          <h2>💰 Caja abierta</h2>
          <span class="badge ok">En turno</span>
          <span class="spacer"></span>
          <span class="small muted">Abrio ${esc(s.opened_by_name || '')} · ${dateTime(s.opened_at)}</span>
        </div>
        <div class="grid grid-4">
          <div class="stat"><h3>Base inicial</h3><div class="value">${money(s.opening_amount)}</div></div>
          <div class="stat orange"><h3>Ventas del turno</h3><div class="value">${money(m.sales_total)}</div>
            <div class="sub">${m.sales_count} ventas</div></div>
          <div class="stat earth"><h3>Abonos recibidos</h3><div class="value">${money(m.credit_payments)}</div></div>
          <div class="stat amber"><h3>Fiado otorgado</h3><div class="value">${money(m.credit_granted)}</div></div>
        </div>
        <div class="grid grid-2" style="margin-top:14px">
          <div class="card card-flat" style="margin:0;background:#fbfaf7">
            <h3 style="font-size:14px;margin-bottom:8px">Detalle de cobros</h3>
            <div class="totals" style="border:0;margin:0;padding:0">
              <div class="line"><span>💵 Efectivo</span><span class="mono">${money(m.cash)}</span></div>
              <div class="line"><span>💳 Tarjeta</span><span class="mono">${money(m.card)}</span></div>
              <div class="line"><span>📱 Transferencia</span><span class="mono">${money(m.transfer)}</span></div>
              <div class="line"><span>📒 Abonos en efectivo</span><span class="mono">${money(m.credit_payments_cash)}</span></div>
              <div class="line"><span>➕ Otros ingresos</span><span class="mono">${money(m.ingresos)}</span></div>
              <div class="line"><span>➖ Egresos / retiros</span><span class="mono">− ${money(m.egresos)}</span></div>
              <div class="line grand"><span>Efectivo esperado</span><span class="mono">${money(m.expected_cash)}</span></div>
            </div>
            <div class="row" style="margin-top:12px">
              <button class="btn btn-soft btn-sm" id="btn-mov-in">➕ Ingreso</button>
              <button class="btn btn-soft btn-sm" id="btn-mov-out">➖ Egreso</button>
              <span class="spacer"></span>
              <button class="btn btn-danger btn-sm" id="btn-close">🔒 Cerrar caja</button>
            </div>
          </div>
          <div class="card card-flat" style="margin:0;background:#fbfaf7">
            <h3 style="font-size:14px;margin-bottom:8px">Movimientos de efectivo</h3>
            ${s.movements.length ? s.movements.map(mv => `
              <div class="list-item">
                <span class="li-ic">${mv.type === 'ingreso' ? '➕' : '➖'}</span>
                <span class="li-body"><strong>${esc(mv.concept || mv.type)}</strong>
                  <small>${dateTime(mv.created_at)} · ${esc(mv.user_name || '')}</small></span>
                <span class="strong ${mv.type === 'ingreso' ? 'ok-text' : 'danger-text'}">
                  ${mv.type === 'ingreso' ? '+' : '−'}${money(mv.amount)}</span>
              </div>`).join('') : '<p class="small muted">Sin movimientos manuales en este turno.</p>'}
            <h3 style="font-size:14px;margin:14px 0 8px">Ultimas ventas del turno</h3>
            ${s.sales.length ? `<div style="max-height:230px;overflow:auto">${s.sales.map(v => `
              <div class="list-item">
                <span class="li-ic">🧾</span>
                <span class="li-body"><strong>${esc(v.folio)}</strong>
                  <small>${dateTime(v.created_at)} · ${esc(v.customer_name || 'Consumidor final')}</small></span>
                <span class="strong">${money(v.total)}</span>
              </div>`).join('')}</div>` : '<p class="small muted">Aun no hay ventas en el turno.</p>'}
          </div>
        </div>
      </div>`;
  }

  function closedHtml() {
    return `<div class="card" style="text-align:center;padding:34px 18px">
      <div style="font-size:44px">🔒</div>
      <h2 style="margin:8px 0">La caja esta cerrada</h2>
      <p class="muted small" style="margin-bottom:16px">Abra la caja con la base inicial para poder vender.</p>
      <button class="btn btn-primary btn-lg" id="btn-open">Abrir caja</button>
    </div>`;
  }

  function openForm() {
    formModal({
      title: 'Apertura de caja',
      submitLabel: 'Abrir caja',
      fields: [
        { name: 'opening_amount', label: 'Base inicial en efectivo', type: 'number', value: 0,
          min: 0, required: true, full: true },
        { name: 'note', label: 'Observacion', full: true },
      ],
      onSubmit: async (values, close) => {
        await api.post('/api/cash/open', values);
        notify.ok('Caja abierta');
        close();
        load();
      },
    });
  }

  function movementForm(type) {
    formModal({
      title: type === 'ingreso' ? 'Registrar ingreso de efectivo' : 'Registrar egreso de efectivo',
      submitLabel: 'Registrar',
      fields: [
        { name: 'amount', label: 'Valor', type: 'number', value: '', min: 0, required: true, full: true },
        { name: 'concept', label: 'Concepto', required: true, full: true,
          placeholder: type === 'ingreso' ? 'Prestamo, aporte...' : 'Pago proveedor, gasolina...' },
      ],
      onSubmit: async (values, close) => {
        await api.post('/api/cash/movements', { ...values, type });
        notify.ok('Movimiento registrado');
        close();
        load();
      },
    });
  }

  function closeForm(s) {
    const expected = s.summary.expected_cash;
    openModal({
      title: 'Cierre de caja',
      body: `
        <p class="small muted">Cuente el efectivo en el cajon y registre el total.</p>
        <div class="totals" style="border:0;padding:0;margin-bottom:12px">
          <div class="line"><span>Base inicial</span><span class="mono">${money(s.opening_amount)}</span></div>
          <div class="line"><span>Ventas en efectivo</span><span class="mono">${money(s.summary.cash)}</span></div>
          <div class="line"><span>Abonos en efectivo</span><span class="mono">${money(s.summary.credit_payments_cash)}</span></div>
          <div class="line"><span>Ingresos</span><span class="mono">${money(s.summary.ingresos)}</span></div>
          <div class="line"><span>Egresos</span><span class="mono">− ${money(s.summary.egresos)}</span></div>
          <div class="line grand"><span>Esperado</span><span class="mono">${money(expected)}</span></div>
        </div>
        <div class="field"><label>Efectivo contado</label>
          <input class="input input-lg mono" type="number" id="counted" step="any" value="${expected}"></div>
        <div class="field"><label>Observaciones</label>
          <input class="input" id="note" placeholder="Novedades del turno"></div>
        <div id="diff" class="card card-flat" style="margin:0;text-align:center;background:#fbfaf7"></div>`,
      footer: `<button class="btn btn-soft" data-close>Cancelar</button>
               <button class="btn btn-danger" data-ok>Cerrar caja</button>`,
      onMount: (root, close) => {
        const counted = root.querySelector('#counted');
        const diff = root.querySelector('#diff');
        const paint = () => {
          const d = Math.round((Number(counted.value || 0) - expected) * 100) / 100;
          diff.innerHTML = `<strong>Diferencia</strong>
            <div style="font-size:24px;font-weight:800"
                 class="${d < 0 ? 'danger-text' : (d > 0 ? 'ok-text' : '')}">${money(d)}</div>
            <span class="small muted">${d < 0 ? 'Faltante en caja' : (d > 0 ? 'Sobrante en caja' : 'Caja cuadrada')}</span>`;
        };
        counted.addEventListener('input', paint);
        paint();
        root.querySelector('[data-ok]').addEventListener('click', async () => {
          try {
            const res = await api.post('/api/cash/close', {
              counted_amount: Number(counted.value || 0),
              note: root.querySelector('#note').value,
            });
            notify.ok('Caja cerrada. Diferencia: ' + money(res.difference));
            close();
            load();
          } catch (e) { notify.error(e.message); }
        });
      },
    });
  }

  await load();
}
