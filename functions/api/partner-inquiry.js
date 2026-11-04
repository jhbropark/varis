// Cloudflare Pages Function for VARIS partnership inquiries.
const RATE = new Map();

function json(body, status = 200, origin = '') {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  });
  if (origin === 'https://varis.kr' || origin === 'https://www.varis.kr') {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

function safe(value, max) {
  if (value == null) return '';
  const text = String(value).trim();
  return text.length > max ? text.slice(0, max) : text;
}

function allowed(ip) {
  const now = Date.now();
  const recent = (RATE.get(ip) || []).filter((time) => now - time < 60000);
  recent.push(now);
  RATE.set(ip, recent);
  if (RATE.size > 500) RATE.clear();
  return recent.length <= 8;
}

async function sendFormspree(payload, env) {
  const formspreeId = env.FORMSPREE_PARTNER || env.FORMSPREE_ID || 'mvznljpl';
  try {
    const response = await fetch('https://formspree.io/f/' + formspreeId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  if (request.method === 'OPTIONS') return json({}, 204, origin);
  if (request.method !== 'POST') {
    return json({ ok: false, reason: 'method_not_allowed' }, 405, origin);
  }
  if (!allowed(ip)) return json({ ok: false, reason: 'rate_limited' }, 429, origin);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, reason: 'invalid_json' }, 400, origin);
  }

  if (body.website || body.url || body.honeypot) {
    return json({ ok: true, id: 'honeypot' }, 200, origin);
  }

  const name = safe(body.name, 80);
  const organization = safe(body.organization, 120);
  const email = safe(body.email, 120).toLowerCase();
  const country = safe(body.country, 80);
  const org_type = safe(body.org_type, 40);
  const interest = safe(body.interest, 40);
  const model = safe(body.model, 40);
  const message = safe(body.message, 2000);
  const ref = safe(body.ref, 80);
  const utm_source = safe(body.utm_source, 80);
  const utm_medium = safe(body.utm_medium, 80);
  const utm_campaign = safe(body.utm_campaign, 80);
  const utm_content = safe(body.utm_content, 80);
  const landing_url = safe(body.landing_url, 500);
  const referrer = safe(body.referrer, 500);

  if (!name || !organization || !email || !country || !org_type) {
    return json({ ok: false, reason: 'missing_required' }, 400, origin);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, reason: 'invalid_email' }, 400, origin);
  }
  if (body.consent !== 'yes') {
    return json({ ok: false, reason: 'consent_required' }, 400, origin);
  }

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const source = 'partners:' + (ref || utm_source || 'direct');
  const crmPayload = {
    contact_type: 'email',
    contact: email,
    email,
    name,
    organization,
    country,
    course_id: 'partner-inquiry',
    course_label: 'VARIS Partner Inquiry',
    source,
    purpose: 'partnership',
    consent: {
      agreed: true,
      scope: 'partner_inquiry',
      version: '2026-11',
      at: new Date().toISOString(),
      policy_url: 'https://varis.kr/privacy/',
    },
    message,
    goal: model || interest || 'partnership discussion',
    qa: false,
    note: '조직 유형: ' + org_type + '\n관심 모듈: ' + (interest || '-') + '\n파트너십 모델: ' + (model || '-') + '\n유입: ' + source + '\nref: ' + (ref || '-') + '\nutm: ' + [utm_source, utm_medium, utm_campaign, utm_content].filter(Boolean).join('/') + '\nlanding: ' + landing_url + '\nreferrer: ' + referrer,
    request_id: id,
  };

  let crmOk = false;
  const crmUrl = env.CRM_INTAKE_URL || env.CRM_API_URL;
  const crmKey = env.CRM_INTAKE_KEY || env.CRM_WORKER_KEY;
  if (crmUrl && crmKey) {
    try {
      const response = await fetch(crmUrl.replace(/\/$/, '') + '/api/crm/intake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + crmKey,
        },
        body: JSON.stringify(crmPayload),
      });
      crmOk = response.ok;
    } catch {
      crmOk = false;
    }
  }

  const delivered = crmOk || await sendFormspree({
    ...body,
    ...crmPayload,
    _subject: '[VARIS Partner Inquiry] ' + organization + ' - ' + country,
  }, env);

  if (!delivered) return json({ ok: false, reason: 'delivery_failed' }, 502, origin);
  return json({ ok: true, id, crm_forwarded: crmOk }, 200, origin);
}
