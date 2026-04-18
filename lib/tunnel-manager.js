const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const CF_API_TOKEN = process.env.CF_API_TOKEN;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_WORKER_NAME = process.env.CF_WORKER_NAME || "veasly-dashboard";
const KV_NAMESPACE = process.env.CF_KV_NAMESPACE_ID;

let tunnelProcess = null;
let currentUrl = null;

// KV에 터널 URL 업데이트
async function updateWorkerKV(tunnelUrl) {
  if (!KV_NAMESPACE) {
    console.log("[TunnelMgr] KV_NAMESPACE not set, skipping KV update");
    return false;
  }
  
  try {
    const resp = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE}/values/TUNNEL_URL`,
      {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${CF_API_TOKEN}`,
          "Content-Type": "text/plain"
        },
        body: tunnelUrl
      }
    );
    const data = await resp.json();
    if (data.success) {
      console.log(`[TunnelMgr] ✅ KV updated: ${tunnelUrl}`);
      return true;
    } else {
      console.error("[TunnelMgr] KV update failed:", data.errors);
      return false;
    }
  } catch (e) {
    console.error("[TunnelMgr] KV update error:", e.message);
    return false;
  }
}

// Quick Tunnel 시작 + URL 감지
function startTunnel() {
  return new Promise((resolve, reject) => {
    console.log("[TunnelMgr] Starting Quick Tunnel...");
    
    tunnelProcess = spawn("cloudflared", ["tunnel", "--url", "http://localhost:3000"], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    
    let resolved = false;
    const urlRegex = /https:\/\/[a-z0-9\-]+\.trycloudflare\.com/;
    
    const checkOutput = (data) => {
      const text = data.toString();
      const match = text.match(urlRegex);
      if (match && !resolved) {
        resolved = true;
        currentUrl = match[0];
        console.log(`[TunnelMgr] ✅ Tunnel URL detected: ${currentUrl}`);
        
        // URL 파일에 저장
        fs.writeFileSync(
          path.join(__dirname, "../data/tunnel-url.json"),
          JSON.stringify({ url: currentUrl, updatedAt: new Date().toISOString() }, null, 2)
        );
        
        // KV 업데이트
        updateWorkerKV(currentUrl).then(() => resolve(currentUrl));
      }
    };
    
    tunnelProcess.stdout.on("data", checkOutput);
    tunnelProcess.stderr.on("data", checkOutput);
    
    tunnelProcess.on("exit", (code) => {
      console.log(`[TunnelMgr] Tunnel exited with code ${code}`);
      if (!resolved) reject(new Error("Tunnel exited before URL detected"));
      
      // 자동 재시작 (5초 후)
      setTimeout(() => {
        console.log("[TunnelMgr] Auto-restarting tunnel...");
        startTunnel();
      }, 5000);
    });
    
    // 30초 타임아웃
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error("Tunnel URL detection timeout"));
      }
    }, 30000);
  });
}

function getCurrentUrl() {
  if (currentUrl) return currentUrl;
  try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/tunnel-url.json"), "utf8"));
    return data.url;
  } catch (e) {
    return null;
  }
}

function stopTunnel() {
  if (tunnelProcess) {
    tunnelProcess.kill();
    tunnelProcess = null;
  }
}

module.exports = { startTunnel, getCurrentUrl, stopTunnel, updateWorkerKV };
