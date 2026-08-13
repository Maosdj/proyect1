// Carrito del cliente: enviar pedido o solicitar cotizacion.

import { api } from '../api.js';
import { esc, money, qty as fmtQty, notify, setActions, emptyState, openModal, confirmDialog } from '../ui.js';
import { getCart, setQty, removeItem, clearCart, cartTotal } from '../cart.js';
import { renderNav } from '../app.js';

export async function render(view) {
  setActions('');

  function draw() {
    const items = getCart();
    if (!items.length) {
      view.innerHTML = `<div class="card">${emptyState('🧺', 'Su pedido esta vacio',
        'Agregue productos desde el catalogo')}
        <div style="text-align:center"><a class="btn btn-primary" href="#/catalog">Ir al catalogo</a></div></div>`;
      renderNav();
      return;
    }

    view.innerHTML = `
      <div class="grid grid-2" style="align-items:start">
        <div class="card">
          <div class="card-head"><h2>🧺 Productos seleccionados</h2>
            <span class="spacer"></span>
            <button class="btn btn-sm btn-soft" id="btn-clear">Vaciar</button></div>
          ${items.map(i => `
            <div class="cart-line">
              <div class="cl-name">${i.image || '📦'} ${esc(i.name)}</div>
              <div class="cl-sub">${money(i.price * i.qty)}</div>
              <div class="cl-meta">
                <div class="qty-box">
                  <button data-dec="${i.product_id}">−</button>
                  <input type="text" inputmode="decimal" value="${fmtQty(i.qty)}" data-qty="${i.product_id}">
                  <button data-inc="${i.product_id}">+</button>
                </div>
                <span class="small muted">${esc(i.unit)} · ${money(i.price)} c/u</span>
                <span class="spacer"></span>
                <button class="btn btn-sm btn-soft" data-del="${i.product_id}">🗑️</button>
              </div>
            </div>`).join('')}
          <div class="totals">
            <div class="line grand"><span>Total estimado</span>
              <span class="mono">${money(cartTotal())}</span></div>
          </div>
          <p class="small muted">Los precios pueden variar. El valor final se confirma en la tienda.</p>
        </div>

        <div class="card">
          <div class="card-head"><h2>📤 Enviar solicitud</h2></div>
          <div class="field">
            <label>Tipo de solicitud</label>
            <select class="input" id="type">
              <option value="pedido">Pedido para recoger en tienda</option>
              <option value="cotizacion">Solicitud de cotizacion</option>
            </select>
          </div>
          <div class="field">
            <label>Observaciones para la tienda</label>
            <textarea class="input" id="note"
              placeholder="Ej: lo recojo mañana a las 8am, necesito factura a nombre de la finca..."></textarea>
          </div>
          <button class="btn btn-primary btn-lg btn-block" id="btn-send">Enviar solicitud</button>
          <p class="small muted" style="margin-top:10px">
            La ferreteria revisara su solicitud, la aprobara y le avisara cuando este lista.
            El pago se realiza en la tienda al recoger.</p>
        </div>
      </div>`;

    view.querySelectorAll('[data-inc]').forEach(b => b.addEventListener('click', () => {
      const item = items.find(i => i.product_id === Number(b.dataset.inc));
      setQty(item.product_id, item.qty + 1); draw();
    }));
    view.querySelectorAll('[data-dec]').forEach(b => b.addEventListener('click', () => {
      const item = items.find(i => i.product_id === Number(b.dataset.dec));
      setQty(item.product_id, item.qty - 1); draw();
    }));
    view.querySelectorAll('[data-qty]').forEach(inp => inp.addEventListener('change', () => {
      const v = Number(String(inp.value).replace(',', '.'));
      setQty(Number(inp.dataset.qty), v > 0 ? v : 0);
      draw();
    }));
    view.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
      removeItem(Number(b.dataset.del)); draw();
    }));

    view.querySelector('#btn-clear').addEventListener('click', async () => {
      if (await confirmDialog({ title: 'Vaciar pedido', message: '¿Quitar todos los productos?', danger: true })) {
        clearCart(); draw();
      }
    });

    view.querySelector('#btn-send').addEventListener('click', async () => {
      const btn = view.querySelector('#btn-send');
      btn.disabled = true;
      btn.textContent = 'Enviando...';
      try {
        const order = await api.post('/api/me/orders', {
          type: view.querySelector('#type').value,
          note: view.querySelector('#note').value,
          items: getCart().map(i => ({ product_id: i.product_id, qty: i.qty })),
        });
        clearCart();
        openModal({
          title: 'Solicitud enviada',
          body: `<div style="text-align:center;padding:10px 0">
              <div style="font-size:44px">✅</div>
              <h2>${esc(order.folio)}</h2>
              <p class="muted small">Su ${order.type === 'cotizacion' ? 'cotizacion' : 'pedido'} por
                <b>${money(order.total)}</b> fue recibido.</p>
              <p class="small">Le avisaremos cuando este listo para recoger en la tienda.</p>
            </div>`,
          footer: `<button class="btn btn-primary btn-block" data-close>Entendido</button>`,
          onClose: () => { location.hash = '#/myorders'; },
        });
        draw();
      } catch (e) {
        notify.error(e.message);
        btn.disabled = false;
        btn.textContent = 'Enviar solicitud';
      }
    });
    renderNav();
  }

  draw();
}
