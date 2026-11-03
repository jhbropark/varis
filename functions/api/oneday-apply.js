// VARIS 원데이 세미나 신청 접수 for Cloudflare Pages Functions.
// CRM intake 전달 + Formspree 폴백. Secrets는 Pages 환경변수에서 읽는다.

const RATE = new Map();
const ALLOWED_DATES = new Set(['2026-11-29', '2026-12-13']);

function safe(value, max) {
  if (value == null) return '';
  const text = String(value).trim();
  return text.length > max ? text.slice(0, max) : text;
}

function allowedOrigin(origin) {
  return origin === 'https://varis.kr' || origin === 'https://www.varis.kr' || /^https:\/\/[a-z0-9-]+\.pages\.dev$/i.test(origin || '');
}

function response(body, status, origin) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  if (allowedOrigin(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  if (status === 204) return new Response(null, { status, headers });
  return new Response(JSON.stringify(body), { status, headers });
}

function checkRate(request) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const values = (RATE.get(ip) || []).filter((time) => now - time < 60000);
  values.push(now);
  RATE.set(ip, values);
  if (RATE.size > 500) RATE.clear();
  return values.length <= 8;
}

export async function onRequestOptions({ request }) {
  const origin = request.headers.get('Origin') || '';
  const result = response({}, 204, origin);
  result.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  result.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return result;
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin') || '';
  if (!checkRate(request)) return response({ ok: false, reason: 'rate_limited' }, 429, origin);

  let body = {};
  try {
    body = await request.json();
  } catch {
    return response({ ok: false, reason: 'invalid_json' }, 400, origin);
  }

  if (body.website || body.url || body.honeypot) {
    return response({ ok: true, id: 'honeypot', share_url: 'https://varis.kr/oneday', crm_forwarded: false }, 200, origin);
  }

  const name = safe(body.name, 20);
  const phoneRaw = safe(body.phone, 20);
  const phone = phoneRaw.replace(/\D/g, '');
  const email = safe(body.email, 80).toLowerCase();
  const desiredDate = safe(body.desired_date, 20);
  const motive = safe(body.motive, 500);
  const inflowPath = safe(body.inflow_path, 30);
  const ref = safe(body.ref, 50);
  const utmSource = safe(body.utm_source, 50);
  const utmMedium = safe(body.utm_medium, 50);
  const utmCampaign = safe(body.utm_campaign, 50);
  const utmContent = safe(body.utm_content, 50);
  const landingUrl = safe(body.landing_url, 500);
  const referrer = safe(body.referrer, 500);

  if (!name || phone.length < 9) return response({ ok: false, reason: 'missing_required' }, 400, origin);
  if (!ALLOWED_DATES.has(desiredDate)) return response({ ok: false, reason: 'invalid_date' }, 400, origin);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response({ ok: false, reason: 'invalid_email' }, 400, origin);
  if (!body.consent) return response({ ok: false, reason: 'consent_required' }, 400, origin);

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const shareUrl = 'https://varis.kr/oneday?applied=' + encodeURIComponent(id) + '&date=' + encodeURIComponent(desiredDate) + (ref ? '&ref=' + encodeURIComponent(ref) : '');

  const crmUrl = env.CRM_INTAKE_URL || env.CRM_API_URL;
  const crmKey = env.CRM_INTAKE_KEY || env.CRM_WORKER_KEY;
  let crmOk = false;
  if (crmUrl && crmKey) {
    try {
      const payload = {
        contact_type: 'phone', contact: phoneRaw, phone: phoneRaw, email: email || undefined, name,
        course_id: 'oneday-' + desiredDate, course_label: '원데이 세미나 ' + desiredDate,
        source: 'oneday:' + (inflowPath || utmSource || 'direct') + (ref ? ' ref:' + ref : ''),
        purpose: 'consultation',
        consent: { agreed: true, scope: 'oneday_seminar', version: '2026-11', at: new Date().toISOString(), policy_url: 'https://varis.kr/privacy/' },
        message: motive, goal: desiredDate, qa: false, contact_type_detail: 'oneday',
        note: '원데이 세미나 신청\n희망일:' + desiredDate + '\n유입:' + (inflowPath || '-') + '\nref:' + (ref || '-') + '\nutm:' + ([utmSource, utmMedium, utmCampaign, utmContent].filter(Boolean).join('/') || '-') + '\nlanding:' + landingUrl + '\nreferrer:' + referrer,
        request_id: id,
      };
      const result = await fetch(crmUrl.replace(/\/$/, '') + '/api/crm/intake', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + crmKey }, body: JSON.stringify(payload),
      });
      crmOk = result.ok;
    } catch { crmOk = false; }
  }

  const formspreeId = env.FORMSPREE_ONEDAY || 'xkjjvzgk';
  let formspreeOk = false;
  if (formspreeId) {
    try {
      const result = await fetch('https://formspree.io/f/' + formspreeId, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name, phone: phoneRaw, email, desired_date: desiredDate, motive, inflow_path: inflowPath, ref, utm_source: utmSource, utm_medium: utmMedium, utm_campaign: utmCampaign, utm_content: utmContent, landing_url: landingUrl, referrer, _subject: '[VARIS 원데이 신청] ' + name + ' / ' + desiredDate }),
      });
      formspreeOk = result.ok;
    } catch { formspreeOk = false; }
  }

  return response({ ok: true, id, share_url: shareUrl, crm_forwarded: crmOk, formspree_forwarded: formspreeOk }, 200, origin);
}
