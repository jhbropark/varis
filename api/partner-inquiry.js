// VARIS partnership inquiry intake: CRM first, Formspree fallback.
function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

const RATE = new Map();
function checkRate(req) {
  const ip = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (RATE.get(ip) || []).filter((time) => now - time < 60000);
  recent.push(now);
  RATE.set(ip, recent);
  if (RATE.size > 500) RATE.clear();
  return recent.length <= 8;
}

function safe(value, max) {
  if (value == null) return '';
  const text = String(value).trim();
  return text.length > max ? text.slice(0, max) : text;
}

async function sendFormspree(payload) {
  const formspreeId = process.env.FORMSPREE_PARTNER || process.env.FORMSPREE_ID || 'mvznljpl';
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://varis.kr');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, reason: 'method_not_allowed' });
  }
  if (!checkRate(req)) return json(res, 429, { ok: false, reason: 'rate_limited' });

  let body = {};
  try {
    body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  } catch {
    return json(res, 400, { ok: false, reason: 'invalid_json' });
  }
  if (body.website || body.url || body.honeypot) return json(res, 200, { ok: true, id: 'honeypot' });

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

  if (!name || !organization || !email || !country || !org_type) return json(res, 400, { ok: false, reason: 'missing_required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { ok: false, reason: 'invalid_email' });
  if (body.consent !== 'yes') return json(res, 400, { ok: false, reason: 'consent_required' });

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
    consent: { agreed: true, scope: 'partner_inquiry', version: '2026-11', at: new Date().toISOString(), policy_url: 'https://varis.kr/privacy/' },
    message,
    goal: model || interest || 'partnership discussion',
    qa: false,
    note: '조직 유형: ' + org_type + '\n관심 모듈: ' + (interest || '-') + '\n파트너십 모델: ' + (model || '-') + '\n유입: ' + source + '\nref: ' + (ref || '-') + '\nutm: ' + [utm_source, utm_medium, utm_campaign, utm_content].filter(Boolean).join('/') + '\nlanding: ' + landing_url + '\nreferrer: ' + referrer,
    request_id: id,
  };

  let crmOk = false;
  const crmUrl = process.env.CRM_INTAKE_URL || process.env.CRM_API_URL;
  const crmKey = process.env.CRM_INTAKE_KEY || process.env.CRM_WORKER_KEY;
  if (crmUrl && crmKey) {
    try {
      const response = await fetch(crmUrl.replace(/\/$/, '') + '/api/crm/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + crmKey },
        body: JSON.stringify(crmPayload),
      });
      crmOk = response.ok;
    } catch {
      crmOk = false;
    }
  }

  const fallbackOk = crmOk || await sendFormspree({
    ...body,
    ...crmPayload,
    _subject: '[VARIS Partner Inquiry] ' + organization + ' - ' + country,
  });
  if (!fallbackOk) return json(res, 502, { ok: false, reason: 'delivery_failed' });
  return json(res, 200, { ok: true, id, crm_forwarded: crmOk });
}
