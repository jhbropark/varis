import {sendBrevoTransactional} from '../_brevo.js';

const ALLOWED_DATES = new Set(['2026-11-29', '2026-12-13']);
const ALLOWED_ORIGINS = new Set(['https://varis.kr', 'https://www.varis.kr']);
const WINDOW_SECONDS = 60;
const DAY_SECONDS = 24 * 60 * 60;
const RETENTION_SECONDS = 30 * DAY_SECONDS;
const DUPLICATE_SECONDS = DAY_SECONDS;
const DISPOSABLE_DOMAINS = new Set(['10minutemail.com','10minutemail.net','guerrillamail.com','mailinator.com','sharklasers.com','tempmail.com','yopmail.com','trashmail.com','getnada.com','maildrop.cc']);

function safe(value, max) {
  if (value == null) return '';
  const text = String(value).trim();
  return text.length > max ? text.slice(0, max) : text;
}

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
  if (status === 204) return new Response(null, { status, headers });
  return new Response(JSON.stringify(body), { status, headers });
}

function getOrigin(request) {
  return request.headers.get('Origin') || '';
}

function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0].trim() || 'unknown';
}

function encodeBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function verifySignedToken(token, secret, origin) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  try {
    const bodyBytes = decodeBase64Url(parts[0]);
    const signatureBytes = decodeBase64Url(parts[1]);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['verify']);
    const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, new TextEncoder().encode(parts[0]));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(bodyBytes));
    if (!payload || payload.origin !== origin || !payload.nonce || Number(payload.exp) < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

async function incrementWindow(env, key, limit, ttl) {
  const current = Number(await env.ONEDAY_KV.get(key) || '0');
  if (!Number.isFinite(current) || current >= limit) return false;
  await env.ONEDAY_KV.put(key, String(current + 1), { expirationTtl: ttl });
  return true;
}

function emailDomain(email) {
  return email.split('@')[1] || '';
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>\"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[char]));
}

function buildConfirmationEmail({name, desiredDate, id, shareUrl}) {
  const safeName = escapeHtml(name);
  const safeDate = escapeHtml(desiredDate);
  const safeId = escapeHtml(id);
  const safeShareUrl = escapeHtml(shareUrl);
  return {
    subject: `[VARIS] 원데이 세미나 신청 접수 안내 (${desiredDate})`,
    textContent: `${name}님, VARIS 원데이 세미나 신청이 접수되었습니다.\n\n희망일: ${desiredDate}\n신청 번호: ${id}\n\n현재 상태는 운영자 확인 대기입니다. 일정과 참석 방법은 확인 후 별도로 안내드립니다.\n신청 확인 링크: ${shareUrl}\n\nVARIS`,
    htmlContent: `<div style="font-family:Arial,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;line-height:1.7;color:#171717;max-width:600px;margin:0 auto"><h2 style="margin:0 0 20px">원데이 세미나 신청 접수</h2><p>${safeName}님, 신청이 접수되었습니다.</p><p><strong>희망일:</strong> ${safeDate}<br><strong>신청 번호:</strong> ${safeId}</p><p>현재 상태는 운영자 확인 대기입니다. 일정과 참석 방법은 확인 후 별도로 안내드립니다.</p><p><a href="${safeShareUrl}" style="color:#d35400">신청 확인 링크 열기</a></p><p style="color:#666;font-size:13px">VARIS</p></div>`,
  };
}

function looksRandom(value) {
  const text = String(value || '').trim();
  return text.length >= 14 && !/\s/.test(text) && /[A-Za-z]/.test(text) && /[A-Z]/.test(text) && /[a-z]/.test(text);
}

function spamScore({name, motive, email, elapsed}) {
  let score = 0;
  if (looksRandom(name)) score += 2;
  if (looksRandom(motive)) score += 2;
  const local = email.split('@')[0] || '';
  if (local.length >= 16 && !/[._-]/.test(local)) score += 1;
  if (DISPOSABLE_DOMAINS.has(emailDomain(email))) score += 3;
  if (elapsed < 3000) score += 1;
  return score;
}

async function verifyTurnstile(request, token, secret) {
  if (!token) return false;
  const form = new FormData();
  form.set('secret', secret);
  form.set('response', token);
  const ip = getClientIp(request);
  if (ip !== 'unknown') form.set('remoteip', ip);
  try {
    const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {method:'POST', body:form});
    const data = await result.json();
    return Boolean(data.success);
  } catch {
    return false;
  }
}

export async function onRequestOptions({request}) {
  const origin = getOrigin(request);
  const result = json({}, 204, origin);
  result.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  result.headers.set('Access-Control-Allow-Headers', 'Content-Type, Accept');
  return result;
}

export async function onRequestGet({request}) {
  return json({ok:false, reason:'method_not_allowed'}, 405, getOrigin(request));
}

export async function onRequestPost({request, env}) {
  const origin = getOrigin(request);
  if (!ALLOWED_ORIGINS.has(origin)) return json({ok:false, reason:'origin_not_allowed'}, 403, origin);
  if (!env.TURNSTILE_SECRET_KEY || !env.FORM_SIGNING_SECRET || !env.ONEDAY_KV) return json({ok:false, reason:'security_not_configured'}, 503, origin);

  const ipHash = await sha256(getClientIp(request));
  const minuteKey = 'rate:ip:' + ipHash + ':' + Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
  const dayKey = 'rate:ipday:' + ipHash + ':' + new Date().toISOString().slice(0, 10);
  if (!(await incrementWindow(env, minuteKey, 8, 120)) || !(await incrementWindow(env, dayKey, 30, DAY_SECONDS + 120))) {
    return json({ok:false, reason:'rate_limited'}, 429, origin);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ok:false, reason:'invalid_json'}, 400, origin);
  }

  if (safe(body.website, 200) || safe(body.url, 200) || safe(body.honeypot, 200)) {
    return json({ok:true, id:'screened', verification_status:'blocked', crm_forwarded:false, formspree_forwarded:false}, 200, origin);
  }

  const tokenPayload = await verifySignedToken(body.form_token, env.FORM_SIGNING_SECRET, origin);
  if (!tokenPayload) return json({ok:false, reason:'invalid_form_token'}, 400, origin);
  const nonceKey = 'nonce:' + tokenPayload.nonce;
  if (await env.ONEDAY_KV.get(nonceKey)) return json({ok:false, reason:'form_token_reused'}, 409, origin);

  const turnstileToken = safe(body.turnstile_token || body['cf-turnstile-response'], 4096);
  if (!(await verifyTurnstile(request, turnstileToken, env.TURNSTILE_SECRET_KEY))) {
    return json({ok:false, reason:'turnstile_failed'}, 400, origin);
  }
  await env.ONEDAY_KV.put(nonceKey, '1', {expirationTtl: 3600});

  const elapsed = Date.now() - Number(tokenPayload.iat);
  const name = safe(body.name, 40);
  const phoneRaw = safe(body.phone, 30);
  const phone = phoneRaw.replace(/\D/g, '');
  const email = safe(body.email, 120).toLowerCase();
  const desiredDate = safe(body.desired_date, 20);
  const motive = safe(body.motive, 500);
  const inflowPath = safe(body.inflow_path, 40);
  const ref = safe(body.ref, 80);
  const utmSource = safe(body.utm_source, 80);
  const utmMedium = safe(body.utm_medium, 80);
  const utmCampaign = safe(body.utm_campaign, 80);
  const utmContent = safe(body.utm_content, 80);
  const landingUrl = safe(body.landing_url, 500);
  const referrer = safe(body.referrer, 500);

  if (!name || phone.length < 9) return json({ok:false, reason:'missing_required'}, 400, origin);
  if (!ALLOWED_DATES.has(desiredDate)) return json({ok:false, reason:'invalid_date'}, 400, origin);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ok:false, reason:'invalid_email'}, 400, origin);
  if (body.consent !== true) return json({ok:false, reason:'consent_required'}, 400, origin);

  const phoneHash = await sha256(phone);
  const emailHash = email ? await sha256(email) : '';
  const duplicatePhone = await env.ONEDAY_KV.get('dedupe:phone:' + phoneHash);
  const duplicateEmail = email ? await env.ONEDAY_KV.get('dedupe:email:' + emailHash) : null;
  if (duplicatePhone || duplicateEmail) {
    return json({ok:true, id:'duplicate_hold', verification_status:'held', crm_forwarded:false, formspree_forwarded:false}, 200, origin);
  }
  await env.ONEDAY_KV.put('dedupe:phone:' + phoneHash, '1', {expirationTtl: DUPLICATE_SECONDS});
  if (email) await env.ONEDAY_KV.put('dedupe:email:' + emailHash, '1', {expirationTtl: DUPLICATE_SECONDS});

  const id = Date.now().toString(36) + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  const shareUrl = 'https://varis.kr/oneday?applied=' + encodeURIComponent(id) + '&date=' + encodeURIComponent(desiredDate) + (ref ? '&ref=' + encodeURIComponent(ref) : '');
  const score = spamScore({name, motive, email, elapsed});
  const commonRecord = {
    id, created_at:new Date().toISOString(), name, phone:phoneRaw, email, desired_date:desiredDate, motive,
    inflow_path:inflowPath, ref, utm_source:utmSource, utm_medium:utmMedium, utm_campaign:utmCampaign,
    utm_content:utmContent, landing_url:landingUrl, referrer, contact_hashes:{phone:phoneHash, email:emailHash},
    verification_required:true, spam_score:score
  };

  if (score >= 4) {
    await env.ONEDAY_KV.put('quarantine:' + id, JSON.stringify({...commonRecord, status:'quarantined'}), {expirationTtl: RETENTION_SECONDS});
    return json({ok:true, id, share_url:shareUrl, verification_status:'quarantined', crm_forwarded:false, formspree_forwarded:false}, 200, origin);
  }

  const applicationKey = 'application:' + id;
  const baseApplication = {...commonRecord, status:'pending_manual_confirmation', email_delivery:{requested:Boolean(email), status:email ? 'queued' : 'not_requested'}};
  await env.ONEDAY_KV.put(applicationKey, JSON.stringify(baseApplication), {expirationTtl: RETENTION_SECONDS});

  // This is a receipt, not identity verification. The manual-confirmation gate remains active.
  let emailDelivery = baseApplication.email_delivery;
  if (email) {
    const content = buildConfirmationEmail({name, desiredDate, id, shareUrl});
    const delivery = await sendBrevoTransactional(env, {
      to: email,
      ...content,
      tags: ['oneday', 'application-receipt'],
    });
    emailDelivery = {
      requested: true,
      status: delivery.status,
      ...(delivery.reason ? {reason: delivery.reason} : {}),
      ...(delivery.message_id ? {message_id: delivery.message_id} : {}),
      ...(delivery.ok ? {sent_at:new Date().toISOString()} : {}),
    };
    await env.ONEDAY_KV.put(applicationKey, JSON.stringify({...baseApplication, email_delivery:emailDelivery}), {expirationTtl: RETENTION_SECONDS});
  }

  return json({ok:true, id, share_url:shareUrl, verification_status:'pending_manual_confirmation', verification_required:true, confirmation_email:email ? (emailDelivery.status === 'sent' ? 'sent' : 'pending') : 'not_requested', crm_forwarded:false, formspree_forwarded:false}, 200, origin);
}
