// Shared helpers: responses, hashing, signed tokens, validation.

export const now = () => Math.floor(Date.now() / 1000);

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export const bad = (msg, status = 400) => json({ error: msg }, status);

const enc = new TextEncoder();

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function b64url(bytes) {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

// Compact signed token: base64url(payload).base64url(hmac)
export async function signToken(payload, secret, ttlSeconds) {
  const body = { ...payload, exp: now() + ttlSeconds };
  const data = b64url(enc.encode(JSON.stringify(body)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

export async function verifyToken(token, secret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlDecode(sig), enc.encode(data));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(data)));
    if (!payload.exp || payload.exp < now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function bearer(request) {
  const h = request.headers.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// Accepts "+91 98765 43210", "09876543210", "9876543210" -> "9876543210"
export function normalisePhone(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

export const clean = (s, max = 120) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

export function sixDigitCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, '0');
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export function newShareId() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint8Array(6))].map((b) => abc[b % abc.length]).join('');
}
