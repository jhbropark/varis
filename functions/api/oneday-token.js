const TOKEN_TTL_SECONDS = 30 * 60;

function encodeBase64Url(value) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(value)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': origin || 'https://varis.kr',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

export async function onRequestOptions({request}) {
  const origin = request.headers.get('Origin') || 'https://varis.kr';
  return json({ok:true}, 204, origin);
}

export async function onRequestGet({request, env}) {
  const origin = request.headers.get('Origin') || 'https://varis.kr';
  if (!env.FORM_SIGNING_SECRET) return json({ok:false, reason:'security_not_configured'}, 503, origin);
  const now = Date.now();
  const payload = {
    iat: now,
    exp: now + TOKEN_TTL_SECONDS * 1000,
    nonce: crypto.randomUUID(),
    origin: new URL(request.url).origin
  };
  const body = encodeBase64Url(JSON.stringify(payload));
  const signature = await sign(body, env.FORM_SIGNING_SECRET);
  return json({ok:true, token: body + '.' + signature, expires_at: payload.exp}, 200, origin);
}

export async function onRequestPost(ctx) {
  return onRequestGet(ctx);
}
