#!/bin/bash
# 터널 재시작 + URL 감지 + Worker 자동 재배포

PROJECT_DIR="/home/ubuntu/veasly-channeltalk-bot"
CF_API_TOKEN=$(grep CF_API_TOKEN "$PROJECT_DIR/.env" | cut -d'=' -f2)
CF_ACCOUNT_ID=$(grep CF_ACCOUNT_ID "$PROJECT_DIR/.env" | cut -d'=' -f2)

echo "[TunnelAuto] 터널 재시작 중..."
pm2 delete tunnel 2>/dev/null
pm2 start cloudflared --name tunnel -- tunnel --url http://localhost:3000

# URL 감지 (최대 30초 대기)
echo "[TunnelAuto] URL 감지 대기..."
NEW_URL=""
for i in $(seq 1 15); do
  sleep 2
  NEW_URL=$(pm2 logs tunnel --nostream --lines 30 2>/dev/null | grep -o 'https://[a-z0-9\-]*\.trycloudflare\.com' | head -1)
  if [ -n "$NEW_URL" ]; then
    break
  fi
done

if [ -z "$NEW_URL" ]; then
  echo "[TunnelAuto] ❌ URL 감지 실패"
  exit 1
fi

echo "[TunnelAuto] ✅ 새 URL: $NEW_URL"

# URL 저장
echo "{\"url\":\"$NEW_URL\",\"updatedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$PROJECT_DIR/data/tunnel-url.json"

# Worker 코드 생성
cat > "$PROJECT_DIR/worker-proxy.js" << WORKEREOF
export default {
  async fetch(request) {
    const TUNNEL_URL = "${NEW_URL}";
    const url = new URL(request.url);
    const targetUrl = TUNNEL_URL + url.pathname + url.search;
    const newHeaders = new Headers(request.headers);
    newHeaders.set("Host", new URL(TUNNEL_URL).host);
    try {
      const resp = await fetch(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.method !== "GET" && request.method !== "HEAD" ? request.body : null,
        redirect: "follow"
      });
      const respHeaders = new Headers(resp.headers);
      respHeaders.set("Access-Control-Allow-Origin", "*");
      return new Response(resp.body, { status: resp.status, headers: respHeaders });
    } catch (e) {
      return new Response("Dashboard temporarily unavailable: " + e.message, { status: 502 });
    }
  }
}
WORKEREOF

# Worker 재배포
echo "[TunnelAuto] Worker 재배포 중..."
cat > /tmp/worker-metadata.json << 'METAEOF'
{
  "main_module": "worker-proxy.js"
}
METAEOF

DEPLOY_RESULT=$(curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/scripts/veasly-dashboard" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -F "metadata=@/tmp/worker-metadata.json;type=application/json" \
  -F "script=@${PROJECT_DIR}/worker-proxy.js;type=application/javascript+module")

rm -f /tmp/worker-metadata.json

SUCCESS=$(echo "$DEPLOY_RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(String(d.success));")

if [ "$SUCCESS" = "true" ]; then
  echo "[TunnelAuto] ✅ Worker 배포 성공"
  echo "[TunnelAuto] 고정 URL: https://veasly-dashboard.gangjun-lee.workers.dev/dashboard.html"
else
  echo "[TunnelAuto] ❌ Worker 배포 실패"
  echo "$DEPLOY_RESULT"
fi

echo "[TunnelAuto] 완료: $(date)"
