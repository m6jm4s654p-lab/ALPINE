const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function equalSecret(input, secret) {
  const digest = value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [a, b] = await Promise.all([digest(input), digest(secret)]);
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  let different = 0;
  for (let i = 0; i < aa.length; i++) different |= aa[i] ^ bb[i];
  return different === 0;
}

async function readBody(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw Error('body');
  const reader = request.body?.getReader();
  if (!reader) throw Error('body');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) { await reader.cancel(); throw Error('body'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function createHandler({ env, fetcher = fetch }) {
  return async request => {
    const origin = request.headers.get('Origin');
    const allowedOrigins = (env('ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean);
    const allowed = origin && allowedOrigins.includes(origin);
    const headers = {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin',
      ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}),
    };
    const reply = (status, data) => new Response(JSON.stringify(data), { status, headers });
    if (!allowed) return reply(403, { error: 'Forbidden' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
      ...headers, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '600',
    } });
    if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' });
    let body;
    try { body = await readBody(request); } catch { return reply(400, { error: 'Invalid request' }); }
    if (!body || Array.isArray(body) || typeof body !== 'object') return reply(400, { error: 'Invalid request' });
    if (body.action !== 'register' && body.action !== 'count') return reply(400, { error: 'Invalid action' });
    const keys = body.action === 'register' ? ['action', 'deviceId'] : ['action', 'code'];
    if (Object.keys(body).some(key => !keys.includes(key))) return reply(400, { error: 'Unexpected fields' });
    if (body.action === 'register' && (typeof body.deviceId !== 'string' || !UUID.test(body.deviceId))) return reply(400, { error: 'Invalid ID' });
    if (body.action === 'count' && (typeof body.code !== 'string' || !/^[a-z0-9]{8,80}$/i.test(body.code))) return reply(400, { error: 'Invalid code' });

    const base = env('SUPABASE_URL');
    let key = env('SUPABASE_SERVICE_ROLE_KEY');
    try { key = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}').default || key; } catch { /* legacy fallback */ }
    if (!base || !key) return reply(503, { error: 'Service unavailable' });
    const db = async (path, options = {}) => {
      const response = await fetcher(`${base}/rest/v1/${path}`, {
        ...options, signal: AbortSignal.timeout(8000), headers: {
          apikey: key, ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }),
          'Content-Type': 'application/json', ...options.headers,
        },
      });
      if (!response.ok) throw Error('Database unavailable');
      return response;
    };
    try {
      if (body.action === 'register') {
        await db('yukinaka_devices?on_conflict=device_id', {
          method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify({ device_id: body.deviceId.toLowerCase() }),
        });
        return reply(200, { ok: true });
      }
      const secret = env('ADMIN_STATS_CODE');
      if (!secret || !/^[a-z0-9]{8,80}$/i.test(secret) || /^(YN4|AC3)/i.test(secret)) return reply(503, { error: 'Service unavailable' });
      const limit = await db('rpc/yukinaka_allow_admin_attempt', { method: 'POST', body: '{}' });
      if (await limit.json() !== true) return reply(429, { error: 'Too many attempts' });
      if (!await equalSecret(body.code, secret)) return reply(401, { error: 'Invalid code' });
      const response = await db('yukinaka_devices?select=device_id', { method: 'HEAD', headers: { Prefer: 'count=exact' } });
      const raw = response.headers.get('content-range')?.split('/')[1];
      if (!raw || !/^\d+$/.test(raw)) throw Error('Invalid count');
      const total = Number(raw);
      if (!Number.isSafeInteger(total)) throw Error('Invalid count');
      return reply(200, { total });
    } catch {
      // Do not log request bodies, identifiers or secrets.
      return reply(503, { error: 'Service unavailable' });
    }
  };
}
