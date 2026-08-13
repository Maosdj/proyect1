// Carrito del modulo cliente (persistente en el navegador).

const KEY = 'agroferre_cart';

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

function write(items) {
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent('cart:change'));
}

export function getCart() {
  return read();
}

export function cartCount() {
  return read().length;
}

export function cartTotal() {
  return read().reduce((sum, i) => sum + i.price * i.qty, 0);
}

export function addToCart(product, quantity = 1) {
  const items = read();
  const found = items.find(i => i.product_id === product.id);
  if (found) {
    found.qty = Math.round((found.qty + quantity) * 100) / 100;
  } else {
    items.push({
      product_id: product.id,
      name: product.name,
      price: product.price,
      unit: product.unit,
      image: product.image || '📦',
      stock: product.stock,
      qty: quantity,
    });
  }
  write(items);
}

export function setQty(productId, quantity) {
  const items = read();
  const found = items.find(i => i.product_id === productId);
  if (!found) return;
  if (quantity <= 0) return removeItem(productId);
  found.qty = Math.round(quantity * 100) / 100;
  write(items);
}

export function removeItem(productId) {
  write(read().filter(i => i.product_id !== productId));
}

export function clearCart() {
  write([]);
}
