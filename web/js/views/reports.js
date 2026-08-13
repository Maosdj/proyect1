// Reportes de ventas, ganancias, vendedores e inventario.

import { api } from '../api.js';
import { esc, money, qty as fmtQty, setActions, emptyState, daysAgo, today, notify } from '../ui.js';

export async function render(view) {
  setActions(`<button class="btn btn-soft btn-sm" id="act-csv">⬇️ Exportar CSV</button>`);
  let last = null;

  view.innerHTML = `
    <div class="card">
      <div class="row">
        <div class="field" style="margin:0"><label class="small">Desde</label>
          <input class="input" type="date" id="f-from" value="${daysAgo(30)}"></div>
        <div class="field" style="margin:0"><label class="small">Hasta</label>
          <input class="input" type="date" id="f-to" value="${today()}"></div>
        <select class="input" id="f-group" style="max-width:170px">
          <option value="day">Por dia</option>
          <option value="week">Por semana</option>
          <option value="month">Por mes</option>
        </select>
        <div class="row row-tight">
          <button class="btn btn-sm btn-soft" data-range="0">Hoy</button>
          <button class="btn btn-sm btn-soft" data-range="7">7 dias</button>
          <button class="btn btn-sm btn-soft" data-range="30">30 dias</button>
          <button class="btn btn-sm btn-soft" data-range="90">90 dias</button>
        </div>
      </div>
    </div>
    <div id="body">Cargando...</div>`;

  const $ = (id) => view.querySelector('#' + id);

  async function load() {
    $('body').innerHTML = '<p class="muted small">Calculando reporte...</p>';
    const data = await api.get('/api/reports/sales', {
      from: $('f-from').value, to: $('f-to').value, group: $('f-group').value,
    });
    last = data;
    const t = data.totals;
    const maxBucket = Math.max(1, ...data.series.map(s => s.total));
    const maxProd = Math.max(1, ...data.top_products.map(p => p.revenue));

    $('body').innerHTML = `
      <div class="grid grid-4" style="margin-bottom:16px">
        <div class="stat orange"><h3>Ventas</h3><div class="value">${money(t.total)}</div>
          <div class="sub">${t.count} facturas</div></div>
        <div class="stat"><h3>Ganancia estimada</h3><div class="value">${money(t.profit)}</div>
          <div class="sub">margen ${t.margin_pct}% · costo ${money(t.cost)}</div></div>
        <div class="stat earth"><h3>Ticket promedio</h3><div class="value">${money(t.ticket_avg)}</div>
          <div class="sub">descuentos ${money(t.discount)}</div></div>
        <div class="stat red"><h3>Fiado del periodo</h3><div class="value">${money(t.credit)}</div>
          <div class="sub">pendiente por cobrar</div></div>
      </div>

      <div class="card">
        <div class="card-head"><h2>📈 Evolucion de ventas</h2></div>
        ${data.series.length ? `<div class="bars" style="height:180px">
          ${data.series.map(s => `<div class="bar-col" title="${esc(s.bucket)}: ${money(s.total)}">
            <div class="bar" style="height:${Math.max(2, s.total / maxBucket * 100)}%"></div>
            <span class="bar-lbl">${esc(String(s.bucket).slice(-5))}</span></div>`).join('')}
        </div>` : emptyState('📈', 'Sin ventas en el periodo')}
      </div>

        <div class="card">
          <div class="card-head"><h2>🏆 Productos mas vendidos</h2></div>
          ${data.top_products.length ? `<div class="table-wrap"><table class="table">
            <thead><tr><th>Producto</th><th class="num">Cantidad</th><th class="num">Vendido</th>
              <th class="num">Ganancia</th></tr></thead>
            <tbody>${data.top_products.map(p => `<tr>
              <td>${esc(p.name)}<div class="hbar" style="margin-top:4px">
                <span style="width:${p.revenue / maxProd * 100}%"></span></div></td>
              <td class="num">${fmtQty(p.qty)} <span class="small muted">${esc(p.unit)}</span></td>
              <td class="num strong">${money(p.revenue)}</td>
              <td class="num ok-text">${money(p.profit)}</td></tr>`).join('')}</tbody>
          </table></div>` : emptyState('🏆', 'Sin datos')}
        </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><h2>🗂️ Por categoria</h2></div>
          ${data.categories.length ? `<div class="table-wrap"><table class="table">
            <thead><tr><th>Categoria</th><th class="num">Unidades</th><th class="num">Vendido</th>
              <th class="num">Ganancia</th></tr></thead>
            <tbody>${data.categories.map(c => `<tr>
              <td>${esc(c.category)}</td>
              <td class="num">${fmtQty(c.qty)}</td>
              <td class="num strong">${money(c.total)}</td>
              <td class="num ok-text">${money(c.profit)}</td></tr>`).join('')}</tbody>
          </table></div>` : emptyState('🗂️', 'Sin datos')}
        </div>

        <div class="card">
          <div class="card-head"><h2>💳 Formas de pago</h2></div>
          ${data.methods.length ? data.methods.map(m => `
            <div class="list-item">
              <span class="li-ic">${({ efectivo: '💵', tarjeta: '💳', transferencia: '📱', credito: '📒' })[m.method] || '💰'}</span>
              <span class="li-body"><strong>${esc(m.method)}</strong><small>${m.count} pagos</small></span>
              <span class="strong">${money(m.total)}</span>
            </div>`).join('') : emptyState('💳', 'Sin pagos registrados')}
        </div>

        <div class="card">
          <div class="card-head"><h2>👤 Ventas por vendedor</h2></div>
          ${data.sellers.length ? data.sellers.map(s => `
            <div class="list-item">
              <span class="li-ic">🧑‍💼</span>
              <span class="li-body"><strong>${esc(s.name)}</strong><small>${s.count} ventas</small></span>
              <span class="strong">${money(s.total)}</span>
            </div>`).join('') : emptyState('👤', 'Sin datos')}
        </div>
      </div>`;
  }

  function exportCsv() {
    if (!last) return;
    const rows = [['Producto', 'Cantidad', 'Unidad', 'Vendido', 'Ganancia']];
    last.top_products.forEach(p => rows.push([p.name, p.qty, p.unit, p.revenue, p.profit]));
    rows.push([]);
    rows.push(['Categoria', 'Unidades', 'Vendido', 'Ganancia']);
    last.categories.forEach(c => rows.push([c.category, c.qty, c.total, c.profit]));
    rows.push([]);
    rows.push(['Totales', 'Facturas', last.totals.count, 'Ventas', last.totals.total,
      'Costo', last.totals.cost, 'Ganancia', last.totals.profit]);
    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `reporte-${last.from}-a-${last.to}.csv`;
    a.click();
    notify.ok('Reporte exportado');
  }

  document.getElementById('act-csv').addEventListener('click', exportCsv);
  ['f-from', 'f-to', 'f-group'].forEach(id => $(id).addEventListener('change', load));
  view.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => {
    $('f-from').value = daysAgo(Number(b.dataset.range));
    $('f-to').value = today();
    load();
  }));

  await load();
}
