const ALLOWED_ORIGINS = new Set(['https://varis.kr', 'https://www.varis.kr']);

function json(body, status, origin) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  return new Response(JSON.stringify(body), {status, headers});
}

function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!local || !domain) return '';
  return `${local.slice(0, 2)}***@${domain}`;
}

function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 4 ? `${digits.slice(0, 3)}****${digits.slice(-4)}` : '';
}

function authorized(request, env) {
  const reportKey = String(env.REPORT_KEY || env.ADMIN_SECRET || '').trim();
  if (!reportKey) return false;
  const bearer = request.headers.get('Authorization') || '';
  const supplied = bearer.startsWith('Bearer ') ? bearer.slice(7).trim() : request.headers.get('X-Report-Key') || '';
  return supplied === reportKey;
}

export async function onRequestGet({request, env}) {
  const origin = request.headers.get('Origin') || '';
  if (!authorized(request, env)) return json({ok:false, reason:'unauthorized'}, 401, origin);
  if (!env.ONEDAY_KV) return json({ok:false, reason:'security_not_configured'}, 503, origin);

  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get('limit') || 50);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.floor(requestedLimit))) : 50;
  const records = [];
  let cursor = '';
  do {
    const listed = await env.ONEDAY_KV.list({prefix:'application:', limit:100, ...(cursor ? {cursor} : {})});
    for (const key of listed.keys || []) {
      const value = await env.ONEDAY_KV.get(key.name, 'json');
      if (value) records.push(value);
    }
    cursor = listed.list_complete ? '' : (listed.cursor || '');
  } while (cursor);
  records.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  const statuses = {};
  const emailStatuses = {};
  for (const record of records) {
    statuses[record.status || 'unknown'] = (statuses[record.status || 'unknown'] || 0) + 1;
    const emailStatus = record.email_delivery?.status || (record.email ? 'legacy_unknown' : 'not_requested');
    emailStatuses[emailStatus] = (emailStatuses[emailStatus] || 0) + 1;
  }

  return json({
    ok:true,
    generated_at:new Date().toISOString(),
    total:records.length,
    statuses,
    email_statuses:emailStatuses,
    recent:records.slice(0, limit).map(record => ({
      id:record.id,
      created_at:record.created_at,
      name:record.name,
      email:maskEmail(record.email),
      phone:maskPhone(record.phone),
      desired_date:record.desired_date,
      status:record.status,
      email_delivery:record.email_delivery || {requested:Boolean(record.email), status:record.email ? 'legacy_unknown' : 'not_requested'},
      spam_score:record.spam_score,
    })),
  }, 200, origin);
}
