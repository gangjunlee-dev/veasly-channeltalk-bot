# CS 피드 연동 가이드 (통합 업무 플랫폼용)

봇이 채널톡·노션에서 계산한 **CS 회신 현황**을 플랫폼 대시보드에 그대로 꽂을 수 있게 내보내는 규격.
데이터는 **영업시간 중 10분마다** 갱신되고, **매 영업일 18:00(KST)**에 일별 추이가 1행 쌓인다.

---

## 1. 연결 방식 — 셋 중 하나만 고르면 됨

| 방식 | 언제 쓰나 | 필요한 것 |
|---|---|---|
| **① Push (권장)** | 플랫폼에 수신 엔드포인트를 만들 수 있을 때 | 봇 `.env`에 `CS_FEED_WEBHOOK_URL` 설정 |
| ② Pull API | 플랫폼 서버에서 당겨오고 싶을 때 | `CS_FEED_TOKEN` + 봇 접근 경로 |
| ③ 파일 | 같은 서버/사이드카에서 읽을 때 | `data/cs-snapshot.json` 직접 읽기 |

> 봇 서버(Oracle)는 **외부에서 직접 접근이 막혀 있다.** 공개 경로는 cloudflared 터널(URL 가변)+Worker 프록시뿐이라,
> 인바운드 의존이 없는 **① Push가 가장 안전**하다. Pull을 쓰려면 Worker에 `/api/cs-feed/*` 프록시를 추가해야 한다.

### ① Push
봇 `.env`에 아래를 넣고 재시작하면, 10분마다 아래 JSON이 그대로 POST된다.
```
CS_FEED_WEBHOOK_URL=https://<플랫폼>/api/cs-feed/ingest
CS_FEED_TOKEN=<공유 시크릿>
```
요청 형태:
```
POST <CS_FEED_WEBHOOK_URL>
Authorization: Bearer <CS_FEED_TOKEN>
X-Feed-Token: <CS_FEED_TOKEN>     (둘 다 보냄 — 편한 쪽으로 검증)
Content-Type: application/json
Body: 아래 §2 스냅샷 JSON 전체
```
플랫폼은 받은 JSON을 그대로 저장(예: D1/Postgres의 kv 한 칸)하고 화면에서 읽으면 된다.
`withHistory: true`인 요청(하루 1회, 마감 시각)만 추이에 1행 추가하면 된다.

### ② Pull API
```
GET  /api/cs-feed/health      인증 불필요 — 갱신 시각·건수만
GET  /api/cs-feed/snapshot    전체(대시보드 한 번에)
GET  /api/cs-feed/metrics     KPI 카드용 요약(가벼움)
GET  /api/cs-feed/awaiting    답변 대기 목록  (?stale=1 → 3영업일+ 만)
GET  /api/cs-feed/promises    미이행 약속 목록
GET  /api/cs-feed/history     일별 추이       (?days=30)
POST /api/cs-feed/refresh     즉시 재계산(운영용, ~1분 소요)
```
인증: `Authorization: Bearer <CS_FEED_TOKEN>` 또는 `X-Feed-Token: <CS_FEED_TOKEN>`
- 토큰 미설정 시 전부 `503` (기본 잠금)
- **브라우저에서 직접 부르지 말 것** — 고객명·문의내용이 들어 있어 토큰이 노출된다. 플랫폼 서버에서 호출할 것.
- 굳이 브라우저에서 부르려면 `CS_FEED_ALLOW_ORIGIN`에 오리진을 등록해야 CORS가 열린다.

---

## 2. 스냅샷 JSON 스키마 (`schema: 1`)

```jsonc
{
  "schema": 1,
  "source": "veasly-channeltalk-bot",
  "generatedAt": "2026-08-24T05:10:00.000Z",   // ISO, UTC
  "openedTotal": 1964,                          // 열린 상담 총수

  "awaiting": {                                 // 고객이 답을 기다리는 상담
    "real":    38,                              // 실제 답변 필요 (KPI 메인)
    "ghosts":  2,                               // 감사·스티커로 끝난 건(자동 종료 대상)
    "today":   1,                               // 8영업시간 미만
    "carried": 1,                               // 8~24영업시간
    "stale":   36,                              // 24영업시간+ (3영업일+, 우선 처리)
    "items": [                                  // 최대 60건, 오래된 순
      {
        "id": "6a8bd4ccd22a22957ec7",
        "name": "陳畋菱",                        // 고객명 (개인정보 — 인증 뒤에만 노출)
        "text": "我希望貨物的通關進度可以不要受到影響…",  // 마지막 고객 메시지(70자 절단)
        "bizH": 175.3,                           // 영업시간 기준 경과(h)
        "link": "https://desk.channel.io/#/channels/138710/user_chats/6a8b…",
        "assigned": true
      }
    ]
  },

  "metrics": {
    "firstReplyMedianH": 10.1,   // 첫 사람응답 소요 중앙값(실시간 h)
    "firstReplyP90H": 60.3,
    "neverReplied": 73,          // 사람 응답 이력 0건인 열린 상담
    "sampleSize": 2020
  },

  "promises": {                  // 노션 "고객 약속 추적"에서 기한 지난 건
    "overdue": 9,
    "items": [
      {
        "customer": "Kim James",
        "due": "2026-08-22T10:00:00.000Z",
        "overdueDays": 2,
        "reinquiry": 3,          // 고객이 다시 물어본 횟수
        "chatLink": "https://desk.channel.io/…",
        "pageUrl": "https://www.notion.so/…"
      }
    ]
  },

  "handoff": { "신규": 13, "처리 중": 12, "해결": 353 }   // CS 넘김 DB 상태 분포 (null 가능)
}
```

### 추이(history) 행
```jsonc
{ "date":"2026-08-24", "awaitingReal":38, "stale":36, "ghosts":2,
  "promisesOverdue":9, "firstReplyMedianH":10.1, "firstReplyP90H":60.3, "openedTotal":1964 }
```

---

## 3. 대시보드 구성 제안 (그대로 써도 됨)

- **KPI 5장**: `awaiting.real`(답변 필요) · `awaiting.stale`(3영업일+ 방치) · `promises.overdue`(미이행 약속) · `metrics.firstReplyMedianH`(첫 응답 중앙값) · `openedTotal`
- **답변 대기 표**: `awaiting.items` — 경과(`bizH`)·고객·마지막 메시지·`link`(새 창). 색상 기준: 24h+ 빨강 / 8h+ 주황 / 4h+ 노랑
- **미이행 약속 표**: `promises.items` — 경과일·고객·재문의 횟수·상담/노션 링크
- **추이**: `history`의 `awaitingReal`·`firstReplyMedianH`
- 표시 문구: `bizH`는 **영업시간 기준**(주말·공휴일·야간 제외)이므로 "3영업일" 같은 단위로 쓰는 게 정확하다

## 4. 주의
- `items`의 고객명·메시지는 **개인정보**다. 인증 뒤에서만 렌더하고 공개 캐시(CDN)에 넣지 말 것.
- 스냅샷은 최대 10분 지연이다. 실시간 정확도가 필요하면 `POST /api/cs-feed/refresh`(~1분)로 강제 갱신.
- `generatedAt`이 20분 넘게 낡았으면 봇 스윕이 멈춘 것 — 대시보드에 "데이터 지연" 배지를 띄우는 걸 권장.
- 필드 추가는 하위호환으로만 한다. 깨는 변경 시 `schema`를 올린다.
