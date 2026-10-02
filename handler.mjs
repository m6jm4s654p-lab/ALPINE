const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = {
  collection: { rpc: 'rare_collection', fields: [] },
  draw: { rpc: 'rare_draw', fields: ['requestId'] },
  create: { rpc: 'rare_exchange_create', fields: ['cardInstanceId'] },
  redeem: { rpc: 'rare_exchange_redeem', fields: ['code'] },
  cancel: { rpc: 'rare_exchange_cancel', fields: ['exchangeId'] },
};
async function readBody(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw Error();
  const reader = request.body?.getReader();
  if (!reader) throw Error();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 4096) { await reader.cancel(); throw Error(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function createHandler({ env, fetcher = fetch }) {
  return async request => {
    const origin = request.headers.get('origin');
    const allowed = Boolean(origin && (env('ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).includes(origin));
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
      ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}) };
    const reply = (status, data) => new Response(JSON.stringify(data), { status, headers });
    if (!allowed) return reply(403, { error: 'forbidden' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
      ...headers, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, content-type, apikey', 'Access-Control-Max-Age': '600',
    } });
    if (request.method !== 'POST') return reply(405, { error: 'method_not_allowed' });
    let body;
    try { body = await readBody(request); } catch { return reply(400, { error: 'invalid_request' }); }
    if (!body || Array.isArray(body) || typeof body !== 'object' || !Object.hasOwn(ACTIONS, body.action)) return reply(400, { error: 'invalid_request' });
    const action = ACTIONS[body.action];
    if (Object.keys(body).some(k => !['action', ...action.fields].includes(k))) return reply(400, { error: 'invalid_request' });
    for (const k of action.fields) {
      if (typeof body[k] !== 'string' || (k !== 'code' && !UUID.test(body[k])) || (k === 'code' && !/^RC1-[0-9A-F]{64}$/.test(body[k]))) return reply(400, { error: 'invalid_request' });
    }
    const authorization = request.headers.get('authorization');
    if (!authorization || !/^Bearer [A-Za-z0-9._-]{20,4096}$/.test(authorization)) return reply(401, { error: 'login_required' });
    const base = env('SUPABASE_URL')?.replace(/\/$/, '');
    let key = env('SUPABASE_SERVICE_ROLE_KEY');
    try { key = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}').default || key; } catch { /* legacy key */ }
    if (!base || !key) return reply(503, { error: 'service_unavailable' });
    try {
      // Never decode unverified JWT claims or trust a userId from a request body.
      const auth = await fetcher(`${base}/auth/v1/user`, { headers: { apikey: key, Authorization: authorization }, signal: AbortSignal.timeout(8000) });
      if (auth.status === 401 || auth.status === 403) return reply(401, { error: 'login_required' });
      if (!auth.ok) throw Error();
      const user = await auth.json();
      if (!UUID.test(user.id || '')) return reply(401, { error: 'login_required' });
      const params = { p_user_id: user.id };
      if (body.action === 'draw') params.p_request_id = body.requestId;
      if (body.action === 'create') params.p_card_instance_id = body.cardInstanceId;
      if (body.action === 'cancel') params.p_exchange_id = body.exchangeId;
      if (body.action === 'redeem') params.p_code = body.code;
      const result = await fetcher(`${base}/rest/v1/rpc/${action.rpc}`, {
        method: 'POST', signal: AbortSignal.timeout(8000),
        headers: { apikey: key, ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }), 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!result.ok) throw Error();
      const data = await result.json();
      if (!data || typeof data !== 'object') throw Error();
      return reply(data.error ? 409 : 200, data);
    } catch {
      // Never log email addresses, bearer tokens, exchange codes, or DB errors.
      return reply(503, { error: 'service_unavailable' });
    }
  };
}
