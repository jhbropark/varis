# VARIS 브랜드 에셋

## 파일

| 파일 | 용도 | 폰트 의존 |
|---|---|---|
| `varis-mark.svg` | 앱 아이콘·파비콘 (다크 라운드 스퀘어 + 앰버 V) | 없음 |
| `varis-mark-mono.svg` | 단색 마크. `currentColor` 상속 — 버튼·인라인 아이콘용 | 없음 |
| `varis-logo-dark.svg` | `◤◢ VARIS` 락업 — 어두운 배경용 | **있음** |
| `varis-logo-light.svg` | `◤◢ VARIS` 락업 — 밝은 배경용 | **있음** |
| `varis-mark-{32,64,180,256,512}.png` | 래스터 마크 (투명 배경) | 없음 |

## 팔레트

| 역할 | HEX |
|---|---|
| Ink (배경) | `#17191e` |
| Accent (앰버) | `#e9a23c` |
| Paper (텍스트) | `#FAFAF8` |

## 워드마크 주의

`◤◢` 심볼은 `<path>` 도형이라 어디서든 동일하게 렌더됩니다.
반면 **"VARIS" 글자는 `<text>` 요소**라 Inter 또는 Pretendard 가 설치돼 있어야
사이트와 같은 모양이 나옵니다. 없으면 시스템 산세리프로 대체됩니다.

외부 배포(인쇄물·제휴사 전달)용으로는 디자인 툴에서 글자를 아웃라인(패스) 변환한
버전을 따로 만드는 것을 권합니다.

## 출처

`varis-mark.svg` 는 운영 중인 `https://varis.kr/favicon.svg` 원본입니다.
락업은 사이트 헤더(`.logo` = `◤◢ VARIS`)를 벡터로 옮긴 것입니다.

`og.png`, `apple-touch-icon.png`, `favicon-32.png` 은 varis.kr 에 배포된 바이너리로,
필요하면 아래에서 직접 받으세요.

- https://varis.kr/og.png
- https://varis.kr/apple-touch-icon.png
- https://varis.kr/favicon-32.png
