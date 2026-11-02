import { createHmac, timingSafeEqual } from 'node:crypto';

const API = 'https://api.stripe.com/v1';
const SIGNATURE_TOLERANCE_S = 300;
// Required by Managed Payments: General - Electronically Supplied Services.
const TAX_CODE = 'txcd_10000000';

export function verifyWebhook(rawBody, header, secret, now = Date.now) {
  const parts = String(header ?? '').split(',').map((part) => part.trim().split('='));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!secret || !timestamp || !signatures.length) return false;
  if (Math.abs(now() / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_S) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
  return signatures.some((signature) => {
    const actual = Buffer.from(signature, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}

export function createStripe(secretKey) {
  async function call(path, params) {
    const res = await fetch(`${API}${path}`, {
      method: params ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params ? new URLSearchParams(params) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Stripe ${res.status}: ${data.error?.message ?? data.error?.type ?? 'unknown'}`);
    return data;
  }

  return {
    createCheckout({ token, productName, amountCents, currency, expiresAt, publicUrl }) {
      return call('/checkout/sessions', {
        mode: 'payment',
        client_reference_id: token,
        expires_at: String(Math.floor(expiresAt / 1000)),
        success_url: `${publicUrl}/?order=${token}`,
        cancel_url: `${publicUrl}/?cancel=${token}`,
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': currency,
        'line_items[0][price_data][unit_amount]': String(amountCents),
        'line_items[0][price_data][tax_behavior]': 'inclusive',
        'line_items[0][price_data][product_data][name]': productName,
        'line_items[0][price_data][product_data][tax_code]': TAX_CODE,
      });
    },
    retrieveCheckout: (id) => call(`/checkout/sessions/${encodeURIComponent(id)}`),
    expireCheckout: (id) => call(`/checkout/sessions/${encodeURIComponent(id)}/expire`, {}),
  };
}
