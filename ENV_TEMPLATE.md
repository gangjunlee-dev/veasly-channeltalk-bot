# 환경변수 설정 안내 (.env)

서버 `~/veasly-channeltalk-bot/.env` 에 아래 키를 넣으세요.
**이번에 새로 채워야 할 것: `ANTHROPIC_API_KEY`** (나머지는 기존 값 유지)

```dotenv
# --- Claude (답변·의도·검증·넘김·리뷰 = 유일한 LLM) ---
ANTHROPIC_API_KEY=              # Claude API 키 (sk-ant-...)  ★필수
CLAUDE_MODEL=claude-sonnet-5    # 현재 운영. 비용 절감하려면 claude-haiku-4-5

# --- 채널톡 ---
CHANNEL_ACCESS_KEY=
CHANNEL_ACCESS_SECRET=

# --- 노션 (넘김 적재 + 지식 동기화) ---
NOTION_TOKEN=                   # ntn_...  (지식 페이지들에 Connections 연결 필요)

# [2026-07-06 제거됨] GEMINI_API_KEY / PINECONE_API_KEY / PINECONE_INDEX_NAME / KNOWLEDGE_SOURCE
#   → Gemini/Pinecone 완전 폐기. 지식은 노션 knowledge.md 단일 소스. 위 키들은 이제 불필요(있어도 무시됨).

# --- 기타 운영 ---
AI_ENABLED=true
PORT=3000
VEASLY_API_URL=
VEASLY_API_TOKEN=
EMAIL_USER=
EMAIL_PASS=
DASHBOARD_USER=
DASHBOARD_PASS=
CF_ACCOUNT_ID=
CF_API_TOKEN=
CF_KV_NAMESPACE_ID=
CF_WORKER_NAME=
```

## 참고 (2026-07-06 Gemini/Pinecone 폐기 완료)
- 답변 생성·의도분류·근거검증·넘김분류·품질리뷰 전부 **Claude(claude-sonnet-5)** 사용.
- 지식베이스 = 노션 → `data/knowledge.md` (매일 04:30 KST 자동 동기화, `scripts/sync-notion-knowledge.js`).
- `GEMINI_API_KEY`/`PINECONE_*`/`KNOWLEDGE_SOURCE`는 코드에서 더 이상 읽지 않음. .env에 남아 있어도 무해하나 정리 가능.
- 노션 integration은 지식 페이지들이 있는 **"운영" 페이지**에 Connections 연결되어 있어야 sync 동작.
