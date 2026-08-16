// 카카오페이 단독 연동 — 결제 준비 (ready)
//
// 카카오페이 심사 통과 요건상 사이트 내에서 실제 결제창이 떠야 합니다.
// SECRET_KEY 는 절대 클라이언트에 노출할 수 없으므로 이 서버리스 함수에서만 사용합니다.
//
// Vercel → Settings → Environment Variables 에 아래 두 개를 등록하세요.
//   KAKAOPAY_SECRET_KEY   가맹점 관리자에서 발급한 SECRET KEY (dev/live 구분)
//   KAKAOPAY_CID          가맹점 CID (테스트: TC0ONETIME)
//
// 흐름: [클라이언트] ready 호출 → next_redirect_url 로 이동(카카오페이 결제창)
//       → approval_url 로 복귀(pg_token) → approve 호출로 결제 확정

const API = 'https://open-api.kakaopay.com/online/v1/payment/ready';

// 판매 상품 정의 — 금액은 서버에서만 결정한다(클라이언트가 보낸 금액을 신뢰하지 않음).
const PRODUCTS = {
  vod:        { name: 'VARIS · AI 미디어아트 첫 한 편 (4주 VOD)',        amount:  39000 },
  ai_core:    { name: 'VARIS AI · AI 영상 도구 실무 입문 (CORE)',        amount: 149000 },
  ai_project: { name: 'VARIS AI · 4주 결과물 완성 과정 (PROJECT)',       amount: 390000 },
  coach_1:    { name: 'houdini 온라인 코칭 · 1회 (60~90분)',             amount: 150000 },
  coach_4:    { name: 'houdini 온라인 코칭 · 4회 패키지',                 amount: 500000 },
  elite:      { name: 'houdini Elite Small Group · 6개월 (일시납)',      amount: 1980000 },
  premium:    { name: 'houdini Premium 1:1 · 6개월 (일시납)',            amount: 3900000 },
};

function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host  = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const secret = process.env.KAKAOPAY_SECRET_KEY;
  const cid    = process.env.KAKAOPAY_CID;
  if (!secret || !cid) {
    // 키가 없으면 결제창을 띄우는 대신 명시적으로 알린다 — 조용히 실패시키지 않는다.
    return res.status(503).json({ ok: false, reason: 'not_configured' });
  }

  const { productId, orderId, userId } = req.body || {};
  const product = PRODUCTS[productId];
  if (!product) return res.status(400).json({ ok: false, reason: 'unknown_product' });

  const partnerOrderId = String(orderId || '').slice(0, 100) || `varis-${productId}`;
  const partnerUserId  = String(userId  || '').slice(0, 100) || 'guest';
  const origin = baseUrl(req);

  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: {
        'Authorization': `SECRET_KEY ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cid,
        partner_order_id: partnerOrderId,
        partner_user_id:  partnerUserId,
        item_name:        product.name,
        quantity:         1,
        total_amount:     product.amount,
        tax_free_amount:  0,
        approval_url: `${origin}/api/kakaopay-approve?order=${encodeURIComponent(partnerOrderId)}&user=${encodeURIComponent(partnerUserId)}`,
        cancel_url:   `${origin}/?pay=cancel`,
        fail_url:     `${origin}/?pay=fail`,
      }),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(502).json({ ok: false, reason: 'kakaopay_error', detail: data });
    }

    // tid 는 approve 단계에서 반드시 필요하다. 서버 세션이 없으므로 HttpOnly 쿠키로 넘긴다.
    res.setHeader('Set-Cookie',
      `varis_tid=${encodeURIComponent(data.tid)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=900`);

    return res.status(200).json({
      ok: true,
      redirectPc:     data.next_redirect_pc_url,
      redirectMobile: data.next_redirect_mobile_url,
      amount:         product.amount,
      itemName:       product.name,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, reason: 'request_failed' });
  }
}
