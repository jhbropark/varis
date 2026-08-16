// 카카오페이 단독 연동 — 결제 승인 (approve)
//
// 카카오페이 결제창에서 사용자가 인증을 마치면 approval_url 로 pg_token 과 함께 돌아온다.
// 이 시점까지는 아직 결제가 확정되지 않았다 — 여기서 approve 를 호출해야 실제로 승인된다.

const API = 'https://open-api.kakaopay.com/online/v1/payment/approve';

function readCookie(req, key) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === key) return decodeURIComponent(v.join('='));
  }
  return null;
}

function page(title, body, ok) {
  const accent = ok ? '#66c08a' : '#e07a7a';
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${title}</title>
<style>body{background:#15171c;color:#eeece6;font-family:'Pretendard','Apple SD Gothic Neo',system-ui,sans-serif;
display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;line-height:1.62}
.box{max-width:460px;text-align:center;background:#20242c;border:1px solid #2f343d;border-radius:16px;padding:34px 30px}
h1{font-size:21px;font-weight:800;letter-spacing:-.02em;margin:0 0 10px;color:${accent}}
p{color:#c4c8cf;font-size:14.5px;margin:0 0 20px}
a{display:inline-block;background:#e9a23c;color:#1a1205;font-weight:700;text-decoration:none;
padding:12px 22px;border-radius:10px;font-size:14px}</style></head>
<body><div class="box"><h1>${title}</h1>${body}<a href="/">VARIS로 돌아가기</a></div></body></html>`;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const secret = process.env.KAKAOPAY_SECRET_KEY;
  const cid    = process.env.KAKAOPAY_CID;
  const { pg_token: pgToken, order, user } = req.query || {};
  const tid = readCookie(req, 'varis_tid');

  if (!secret || !cid) {
    return res.status(503).send(page('결제 준비 중입니다',
      '<p>결제 연동이 아직 설정되지 않았습니다. varis@varis.kr 로 문의해 주세요.</p>', false));
  }
  if (!pgToken || !tid) {
    return res.status(400).send(page('결제가 완료되지 않았습니다',
      '<p>결제가 취소되었거나 정보가 만료되었습니다. 다시 시도해 주세요.</p>', false));
  }

  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: {
        'Authorization': `SECRET_KEY ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cid,
        tid,
        partner_order_id: order || 'varis',
        partner_user_id:  user  || 'guest',
        pg_token: pgToken,
      }),
    });

    const data = await r.json().catch(() => ({}));
    // 승인 성공 여부와 무관하게 tid 쿠키는 즉시 폐기한다 (재사용 방지).
    res.setHeader('Set-Cookie', 'varis_tid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');

    if (!r.ok) {
      return res.status(502).send(page('결제 승인에 실패했습니다',
        '<p>결제가 승인되지 않았습니다. 금액이 청구되었다면 varis@varis.kr 로 알려주시면 바로 확인해 드립니다.</p>', false));
    }

    const amount = data?.amount?.total ?? '';
    return res.status(200).send(page('결제가 완료되었습니다',
      `<p>${data.item_name || '주문'}${amount ? ` · ${Number(amount).toLocaleString('ko-KR')}원` : ''}<br />
       영업일 기준 1일 이내에 수강 안내를 이메일로 보내드립니다.</p>`, true));
  } catch (err) {
    return res.status(500).send(page('결제 처리 중 오류가 발생했습니다',
      '<p>잠시 후 다시 시도하시거나 varis@varis.kr 로 연락해 주세요.</p>', false));
  }
}
