// Generacion de tickets y facturas imprimibles / descargables.

import { state } from './api.js';
import { esc, money, qty, dateTime } from './ui.js';

function docHtml(sale, format) {
  const s = state.settings || {};
  const wide = format === 'factura';
  const rows = sale.items.map(i => `
    <tr>
      <td>${esc(i.name)}<br><span class="dim">${qty(i.qty)} ${esc(i.unit)} x ${money(i.price)}${
        i.discount ? ' - dcto ' + money(i.discount) : ''}</span></td>
      <td class="r">${money(i.subtotal)}</td>
    </tr>`).join('');

  const pays = (sale.payments || []).map(p =>
    `<div class="line"><span>${p.method}</span><span>${money(p.amount)}</span></div>`).join('');

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>${esc(sale.folio)}</title>
<style>
  @page { size: ${wide ? 'A4' : '80mm auto'}; margin: ${wide ? '14mm' : '4mm'}; }
  body { font-family: ${wide ? '-apple-system, Arial, sans-serif' : '"Courier New", monospace'};
         font-size: ${wide ? '13px' : '12px'}; color: #000; margin: 0 auto;
         max-width: ${wide ? '190mm' : '72mm'}; }
  h1 { font-size: ${wide ? '20px' : '15px'}; margin: 0 0 2px; text-align: center; }
  .center { text-align: center; }
  .dim { color: #555; font-size: ${wide ? '11px' : '10.5px'}; }
  .sep { border-top: 1px dashed #000; margin: 7px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 3px 0; vertical-align: top; }
  .r { text-align: right; white-space: nowrap; }
  .line { display: flex; justify-content: space-between; padding: 1.5px 0; }
  .total { font-size: ${wide ? '19px' : '15px'}; font-weight: bold; border-top: 2px solid #000;
           margin-top: 5px; padding-top: 5px; }
  .box { border: 1px solid #000; padding: 6px; margin-top: 8px; font-size: 11.5px; }
  .foot { margin-top: 12px; text-align: center; font-size: 11px; }
</style></head><body>
  <h1>${esc(s.business_name || 'AgroFerre')}</h1>
  <div class="center dim">
    ${esc(s.nit ? 'NIT ' + s.nit : '')}<br>
    ${esc(s.address || '')}<br>${esc(s.phone ? 'Tel. ' + s.phone : '')}
  </div>
  <div class="sep"></div>
  <div class="line"><span><b>${wide ? 'FACTURA DE VENTA' : 'TICKET'}</b></span><span><b>${esc(sale.folio)}</b></span></div>
  <div class="line"><span>Fecha</span><span>${dateTime(sale.created_at)}</span></div>
  <div class="line"><span>Atendio</span><span>${esc(sale.user_name || '')}</span></div>
  ${sale.customer_name ? `<div class="line"><span>Cliente</span><span>${esc(sale.customer_name)}</span></div>` : ''}
  ${sale.customer_doc ? `<div class="line"><span>Doc/NIT</span><span>${esc(sale.customer_doc)}</span></div>` : ''}
  <div class="sep"></div>
  <table>${rows}</table>
  <div class="sep"></div>
  <div class="line"><span>Subtotal</span><span>${money(sale.subtotal)}</span></div>
  ${sale.discount ? `<div class="line"><span>Descuento</span><span>- ${money(sale.discount)}</span></div>` : ''}
  <div class="line total"><span>TOTAL</span><span>${money(sale.total)}</span></div>
  ${pays ? `<div class="sep"></div><div class="dim">Pagos</div>${pays}` : ''}
  ${sale.balance > 0 ? `<div class="box"><b>VENTA A CREDITO (FIADO)</b><br>
      Abonado: ${money(sale.paid)}<br>Saldo pendiente: <b>${money(sale.balance)}</b></div>` : ''}
  ${sale.note ? `<div class="dim" style="margin-top:6px">Nota: ${esc(sale.note)}</div>` : ''}
  <div class="foot">${esc(s.ticket_footer || '')}<br>${sale.status === 'anulada' ? '*** VENTA ANULADA ***' : ''}</div>
</body></html>`;
}

export function printTicket(sale, format = 'ticket') {
  const frame = document.getElementById('print-frame');
  const doc = frame.contentWindow.document;
  doc.open();
  doc.write(docHtml(sale, format));
  doc.close();
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }, 250);
}

export function downloadTicket(sale, format = 'ticket') {
  const blob = new Blob([docHtml(sale, format)], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${format}-${sale.folio}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function ticketPreviewHtml(sale) {
  return docHtml(sale, 'ticket');
}
