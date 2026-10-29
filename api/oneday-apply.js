// 원데이 세미나 신청 접수 — CRM intake로 전달 + Formspree 폴백
// Vercel Serverless Function (Node). 신청 링크의 UTM/ref를 함께 저장한다.

function json(res, status, body){
  res.statusCode = status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(body));
}

const RATE = new Map(); // ip -> timestamps (per-instance rate limit)
function checkRate(req){
  const ip = (req.headers['x-forwarded-for']||req.headers['x-real-ip']||'').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const arr = (RATE.get(ip)||[]).filter(t=> now - t < 60000);
  arr.push(now);
  RATE.set(ip, arr);
  if(RATE.size>500) RATE.clear();
  return arr.length <= 8; // 1분에 8회까지
}

function safe(v, max){
  if(v==null) return '';
  const s=String(v).trim();
  return s.length>max ? s.slice(0,max) : s;
}

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin','https://varis.kr');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method === 'OPTIONS') return json(res, 204, {});
  if(req.method !== 'POST'){
    res.setHeader('Allow','POST');
    return json(res, 405, {ok:false, reason:'method_not_allowed'});
  }
  if(!checkRate(req)) return json(res,429,{ok:false,reason:'rate_limited'});
  let body={};
  try{
    body = typeof req.body==='object' ? req.body : JSON.parse(req.body||'{}');
  }catch{ return json(res,400,{ok:false,reason:'invalid_json'}); }
  if(body.website || body.url || body.honeypot) return json(res,200,{ok:true, id:'honeypot', share_url:'https://varis.kr/oneday', crm_forwarded:false}); // honeypot

  const name = safe(body.name, 20);
  const phoneRaw = safe(body.phone, 20);
  const phone = phoneRaw.replace(/\D/g,'');
  const email = safe(body.email, 80).toLowerCase();
  const desired_date = safe(body.desired_date, 20);
  const motive = safe(body.motive, 500);
  const inflow_path = safe(body.inflow_path, 30);
  const ref = safe(body.ref, 50);
  const utm_source = safe(body.utm_source, 50);
  const utm_medium = safe(body.utm_medium, 50);
  const utm_campaign = safe(body.utm_campaign, 50);
  const utm_content = safe(body.utm_content, 50);
  const landing_url = safe(body.landing_url, 500);
  const referrer = safe(body.referrer, 500);

  if(!name || phone.length < 9) return json(res,400,{ok:false,reason:'missing_required'});
  if(!desired_date) return json(res,400,{ok:false,reason:'missing_date'});
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res,400,{ok:false,reason:'invalid_email'});
  if(!body.consent) return json(res,400,{ok:false,reason:'consent_required'});

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  const share_url = `https://varis.kr/oneday?applied=${encodeURIComponent(id)}${ref?`&ref=${encodeURIComponent(ref)}`:''}`;

  // CRM intake 로 전달 (sign.varis.kr). 환경변수가 없으면 스킵하고 ok로 응답.
  const crmUrl = process.env.CRM_INTAKE_URL || process.env.CRM_API_URL;
  const crmKey = process.env.CRM_INTAKE_KEY || process.env.CRM_WORKER_KEY;
  let crmOk = false;
  if(crmUrl && crmKey){
    try{
      const payload = {
        contact_type: 'phone',
        contact: phoneRaw,
        phone: phoneRaw,
        email: email || undefined,
        name,
        course_id: 'oneday-2026-11-29',
        course_label: `원데이 세미나 ${desired_date}`,
        source: `oneday:${inflow_path||utm_source||'direct'}${ref?' ref:'+ref:''}`,
        purpose: 'consultation',
        consent: {agreed:true, scope:'oneday_seminar', version:'2026-11', at:new Date().toISOString(), policy_url:'https://varis.kr/privacy/'},
        message: motive,
        goal: desired_date,
        qa: false,
        contact_type_detail: 'oneday',
        // UTM/ref를 메모/메타로 함께 전달
        note: `원데이 세미나 신청\n희망일:${desired_date}\n유입:${inflow_path||'-'}\nref:${ref||'-'}\nutm:${[utm_source,utm_medium,utm_campaign,utm_content].filter(Boolean).join('/')||'-'}\nlanding:${landing_url}\nreferrer:${referrer}`,
        request_id: id
      };
      const r = await fetch(crmUrl.replace(/\/$/,'') + '/api/crm/intake', {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+crmKey},
        body: JSON.stringify(payload)
      });
      crmOk = r.ok;
    }catch(e){ crmOk=false; }
  }

  // Formspree 폴백 (기존 varis.kr과 동일 엔드포인트 사용 시)
  const formspree = process.env.FORMSPREE_ONEDAY || process.env.FORMSPREE_ID;
  if(!crmOk && formspree){
    try{
      await fetch(`https://formspree.io/f/${formspree}`,{
        method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'},
        body: JSON.stringify({name, phone:phoneRaw, email, desired_date, motive, ref, utm_source, utm_campaign, landing_url, _subject:`[VARIS 원데이] ${name} / ${desired_date} ${ref?'ref:'+ref:''}`})
      });
    }catch{}
  }

  return json(res,200,{ok:true, id, share_url, crm_forwarded: crmOk});
}
