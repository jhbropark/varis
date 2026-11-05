# varis.kr

VARIS 아카데미 원페이지 + 카카오페이 단독 연동 결제 API.

## 구성

```
index.html              전 과정 원페이지 (자체 완결형, 빌드 불필요)
api/kakaopay-ready.js   카카오페이 결제 준비 — 금액은 서버에서 결정
api/kakaopay-approve.js 카카오페이 결제 승인 — approval_url 복귀 처리
KAKAOPAY_REVIEW.md      카카오페이 심사 대응 현황 · 회신 메일 초안
STRUCTURE.md            기존 5개 도메인 구조 분석
```

## 배포 전 필수 환경변수

Vercel → 프로젝트 → Settings → Environment Variables 에 등록:

| 키 | 설명 |
|---|---|
| `KAKAOPAY_SECRET_KEY` | 카카오페이 가맹점 관리자에서 발급한 SECRET KEY |
| `KAKAOPAY_CID` | 가맹점 CID (테스트: `TC0ONETIME`) |

둘 중 하나라도 없으면 `/api/kakaopay-ready` 가 `503 {"reason":"not_configured"}` 를
반환하고 결제 버튼이 "카드결제는 준비 중입니다" 를 노출합니다. 조용히 실패하지 않습니다.

### 설정 확인

```bash
vercel env ls                      # 등록된 키 목록 (값은 표시되지 않음)
curl -s -X POST https://varis.kr/api/kakaopay-ready \
  -H 'Content-Type: application/json' -d '{"productId":"vod"}' | head -c 200
```

`{"ok":true,...}` 면 정상, `{"ok":false,"reason":"not_configured"}` 면 키 미등록입니다.

## 배포

```bash
vercel --prod
```

### 원데이 신청 메일

`functions/api/oneday-apply.js`는 신청을 먼저 `ONEDAY_KV`에 `pending_manual_confirmation` 상태로 저장한 뒤, 이메일이 입력된 경우에만 Brevo transactional API(`/v3/smtp/email`)로 접수 확인 메일을 보냅니다. 이 메일은 본인인증 메일이 아니며, 수동 확인 게이트는 그대로 유지됩니다.

필요한 환경변수:

| 키 | 용도 |
|---|---|
| `BREVO_API_KEY` | Brevo transactional API 인증 키 |
| `EMAIL_FROM` | 발신자 주소. 미설정 시 `varis@varis.kr` |
| `EMAIL_FROM_NAME` | 발신자 표시명. 미설정 시 `VARIS` |
| `REPORT_KEY` 또는 `ADMIN_SECRET` | `/api/oneday-report` 조회 인증용. 메일 발송에는 사용하지 않음 |

메일 설정이 없거나 Brevo가 실패해도 신청 데이터는 보존되고 신청 API는 성공을 반환합니다. 응답의 `confirmation_email`과 KV의 `email_delivery`로 발송 상태를 구분합니다. 관리자 리포트는 `Authorization: Bearer <REPORT_KEY>` 또는 `X-Report-Key` 헤더로 조회하며 이메일과 전화번호는 마스킹됩니다.

<!-- deploy trigger 2026-10-30 18:40 -->
