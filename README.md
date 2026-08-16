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
