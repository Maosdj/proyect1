// Dashboard del administrador.

import { api } from '../api.js';
import { esc, money, qty as fmtQty, setActions, dateTime, emptyState } from '../ui.js';

export async function render(view) {
  setActions(`<button class="btn btn-primary btn-sm" id="act-pos">🧾 Ir al POS</button>`);
  document.getElementById('act-pos').addEventListener('click', () => { location.hash = '#/pos'; });

  const d = await api.get('/api/reports/dashboard');
  const maxDay = Math.max(1, ...d.series.map(s => s.total));
  const maxCat = Math.max(1, ...d.by_category.map(c => c.total));
  const maxProd = Math.max(1, ...d.top_products.map(p => p.qty));

  view.innerHTML = `
    ${d.cash_open ? '' : `<div class="card" style="border-left:4px solid var(--ambar)">
      <strong>⚠️ La caja esta cerrada.</strong>
      <span class="small muted">Abra la caja para poder registrar ventas.</span>
      <a class="btn btn-sm btn-primary" href="#/cash" style="margin-left:8px">Abrir caja</a></div>`}

    <div class="grid grid-4" style="margin-bottom:16px">
      <div class="stat orange"><h3>Ventas de hoy</h3><div class="value">${money(d.today.total)}</div>
        <div class="sub">${d.today.count} ventas · ticket promedio ${money(d.today.ticket_avg)}</div></div>
      <div class="stat"><h3>Esta semana</h3><div class="value">${money(d.week.total)}</div>
        <div class="sub">${d.week.count} ventas</div></div>
      <div class="stat earth"><h3>Este mes</h3><div class="value">${money(d.month.total)}</div>
        <div class="sub">ganancia estimada ${money(d.month.profit)} (${d.month.margin_pct}%)</div></div>
      <div class="stat red"><h3>Por cobrar (fiado)</h3><div class="value">${money(d.credits.pending)}</div>
        <div class="sub">${d.credits.customers} clientes</div></div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h2>📈 Ventas de los ultimos 14 dias</h2></div>
        <div class="bars">
          ${d.series.map(s => `
            <div class="bar-col" title="${s.label}: ${money(s.total)} (${s.count} ventas)">
              <div class="bar" style="height:${Math.max(2, s.total / maxDay * 100)}%"></div>
              <span class="bar-lbl">${s.label.slice(0, 2)}</span>
            </div>`).join('')}
        </div>
        <div class="row" style="margin-top:10px">
          <span class="small muted">Total periodo:
            <b>${money(d.series.reduce((s, x) => s + x.total, 0))}</b></span>
          <span class="spacer"></span>
          <span class="small muted">Ganancia:
            <b class="ok-text">${money(d.series.reduce((s, x) => s + x.profit, 0))}</b></span>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>🏆 Mas vendidos del mes</h2></div>
        ${d.top_products.length ? d.top_products.slice(0, 8).map(p => `
          <div style="margin-bottom:10px">
            <div class="row" style="gap:6px">
              <span class="small strong" style="flex:1">${esc(p.name)}</span>
              <span class="small mono">${fmtQty(p.qty)} ${esc(p.unit)}</span>
              <span class="small mono strong">${money(p.revenue)}</span>
            </div>
            <div class="hbar"><span style="width:${p.qty / maxProd * 100}%"></span></div>
          </div>`).join('') : emptyState('🏆', 'Aun no hay ventas este mes')}
      </div>

      <div class="card">
        <div class="card-head"><h2>⚠️ Alertas de inventario</h2>
          <span class="spacer"></span>
          <a class="btn btn-sm btn-soft" href="#/products">Ver inventario</a></div>
        ${d.low_stock.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Producto</th><th>Categoria</th><th class="num">Stock</th><th>Estado</th></tr></thead>
          <tbody>${d.low_stock.map(p => `<tr>
            <td>${esc(p.name)}</td>
            <td class="small muted">${esc(p.category_name || '—')}</td>
            <td class="num">${fmtQty(p.stock)} <span class="small muted">${esc(p.unit)}</span></td>
            <td>${p.stock <= 0 ? '<span class="badge danger">Agotado</span>'
              : '<span class="badge warn">Bajo (min ' + fmtQty(p.min_stock) + ')</span>'}</td>
          </tr>`).join('')}</tbody></table></div>`
          : emptyState('✅', 'Todo el inventario esta en niveles correctos')}
      </div>

      <div class="card">
        <div class="card-head"><h2>🗂️ Ventas por categoria (mes)</h2></div>
        ${d.by_category.length ? d.by_category.map(c => `
          <div style="margin-bottom:10px">
            <div class="row" style="gap:6px">
              <span class="small strong" style="flex:1">${esc(c.category)}</span>
              <span class="small mono">${money(c.total)}</span>
            </div>
            <div class="hbar"><span style="width:${c.total / maxCat * 100}%;
              background:${esc(c.color || 'var(--naranja)')}"></span></div>
          </div>`).join('') : emptyState('🗂️', 'Sin datos del mes')}
      </div>

      <div class="card">
        <div class="card-head"><h2>🧾 Ultimas ventas</h2>
          <span class="spacer"></span>
          <a class="btn btn-sm btn-soft" href="#/sales">Ver todas</a></div>
        ${d.recent_sales.length ? d.recent_sales.map(s => `
          <div class="list-item">
            <span class="li-ic">🧾</span>
            <span class="li-body"><strong>${esc(s.folio)} · ${esc(s.customer_name || 'Consumidor final')}</strong>
              <small>${dateTime(s.created_at)} · ${esc(s.user_name || '')}</small></span>
            <span class="strong">${money(s.total)}</span>
          </div>`).join('') : emptyState('🧾', 'Sin ventas registradas')}
      </div>

      <div class="card">
        <div class="card-head"><h2>📦 Estado del negocio</h2></div>
        <div class="list-item"><span class="li-ic">📦</span>
          <span class="li-body"><strong>${d.inventory.products} productos activos</strong>
            <small>Valor a costo ${money(d.inventory.cost_value)}</small></span>
          <span class="strong">${money(d.inventory.sale_value)}</span></div>
        <div class="list-item"><span class="li-ic">📥</span>
          <span class="li-body"><strong>${d.pending_orders} pedidos por atender</strong>
            <small>Solicitudes de clientes desde el catalogo</small></span>
          <a class="btn btn-sm btn-soft" href="#/orders">Ver</a></div>
        <div class="list-item"><span class="li-ic">📒</span>
          <span class="li-body"><strong>${money(d.credits.pending)} en fiados</strong>
            <small>${d.credits.customers} clientes con saldo pendiente</small></span>
          <a class="btn btn-sm btn-soft" href="#/credits">Ver</a></div>
        <div class="list-item"><span class="li-ic">💰</span>
          <span class="li-body"><strong>Caja ${d.cash_open ? 'abierta' : 'cerrada'}</strong>
            <small>Turno actual del punto de venta</small></span>
          <a class="btn btn-sm btn-soft" href="#/cash">Ver</a></div>
      </div>
    </div>`;
}
