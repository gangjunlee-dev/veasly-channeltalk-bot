module.exports = {
  apps: [{
    name: "tunnel",
    script: "/usr/local/bin/cloudflared",
    args: "tunnel --url http://localhost:3000",
    autorestart: true,
    watch: false,
    post_start: "bash /home/ubuntu/veasly-channeltalk-bot/lib/tunnel-auto.sh"
  }]
};
