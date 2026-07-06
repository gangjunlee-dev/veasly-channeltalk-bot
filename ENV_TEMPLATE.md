# 환경변수 설정 안내 (.env)

서버 `~/veasly-channeltalk-bot/.env` 에 아래 키를 넣으세요.
**이번에 새로 채워야 할 것: `ANTHROPIC_API_KEY`** (나머지는 기존 값 유지)

```dotenv
# --- Claude (답변 생성, 신규) ---
ANTHROPIC_API_KEY=              # ← Claude API 키 (sk-ant-...)  ★새로 추가
CLAUDE_MODEL=claude-haiku-4-5   # 테스트용. 품질 부족 시 claude-sonnet-5 로 변경
KNOWLEDGE_SOURCE=pinecone       # 지식 소스: pinecone(기존) | notion(신규). 전환 준비되면 notion

# --- 채널톡 (기존) ---
CHANNEL_ACCESS_KEY=
CHANNEL_ACCESS_SECRET=

# --- 노션 (넘김 적재 + 지식 동기화, 기존) ---
NOTION_TOKEN=                   # ntn_...  (지식 페이지들에 Connections 연결 필요)

# --- Gemini (검색 임베딩용. Notion 전환 완료 시 제거 가능) ---
GEMINI_API_KEY=

# --- Pinecone (RAG. Notion 전환 완료 시 제거 가능) ---
PINECONE_API_KEY=
PINECONE_INDEX_NAME=veasly-cs

# --- 기타 운영 (기존) ---
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

## 추가 절차
1. 위 `ANTHROPIC_API_KEY` 값을 서버 `.env`에 추가 (기존 줄은 그대로 두고 새 줄만 추가)
2. `CLAUDE_MODEL`, `KNOWLEDGE_SOURCE` 줄도 추가
3. `pm2 restart veasly-bot --update-env` 로 반영
4. (Notion 전환 시) 노션 integration을 지식 페이지들이 있는 **"운영" 페이지**에 Connections 연결
