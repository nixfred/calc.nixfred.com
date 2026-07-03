/* calc.nixfred.com feedback endpoint. Phase 7 of the calculator plan.
   POST /api/feedback {calculator, useful, message, contact, website}
   Protections: same-origin CORS, honeypot field, length caps, per-IP
   rate limit (5 per 10 minutes), optional Turnstile when secret is set.
   Privacy: raw IPs are never stored, only a salted SHA-256 hash. */

const ORIGIN = 'https://calc.nixfred.com';
const MAX_MESSAGE = 2000;
const MAX_SMALL = 200;
const RATE_LIMIT = 5;
const RATE_WINDOW_MIN = 10;

const cors = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', ...cors },
});

async function ipHash(request) {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const data = new TextEncoder().encode('calc-feedback-salt-v1:' + ip);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/feedback/health') return json(200, { ok: true });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json(405, { error: 'POST only' });

    let body;
    try { body = await request.json(); } catch { return json(400, { error: 'JSON body required' }); }

    // Honeypot: real users never fill a field named "website".
    if (body.website) return json(200, { ok: true });

    const calculator = String(body.calculator ?? '').slice(0, MAX_SMALL).trim();
    const useful = body.useful === null || body.useful === undefined ? null : (body.useful ? 1 : 0);
    const message = String(body.message ?? '').slice(0, MAX_MESSAGE).trim();
    const contact = String(body.contact ?? '').slice(0, MAX_SMALL).trim();
    if (!calculator || (!message && useful === null)) return json(400, { error: 'Say something useful: a rating or a message.' });

    // Optional Turnstile verification once a widget secret exists.
    if (env.TURNSTILE_SECRET) {
      const tokenOk = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: body.turnstileToken ?? '' }),
      }).then((r) => r.json()).then((r) => r.success).catch(() => false);
      if (!tokenOk) return json(403, { error: 'Verification failed.' });
    }

    const hash = await ipHash(request);
    const recent = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM feedback WHERE ip_hash = ?1 AND created_at > datetime('now', ?2)`
    ).bind(hash, `-${RATE_WINDOW_MIN} minutes`).first();
    if ((recent?.n ?? 0) >= RATE_LIMIT) return json(429, { error: 'Easy there. Try again in a few minutes.' });

    await env.DB.prepare(
      `INSERT INTO feedback (calculator, useful, message, contact, ip_hash) VALUES (?1, ?2, ?3, ?4, ?5)`
    ).bind(calculator, useful, message || null, contact || null, hash).run();

    return json(200, { ok: true });
  },
};
