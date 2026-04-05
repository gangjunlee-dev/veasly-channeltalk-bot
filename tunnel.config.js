module.exports = {
  apps: [
    {
      name: "veasly-tunnel",
      script: "cloudflared",
      args: "tunnel --url http://localhost:3000",
      interpreter: "none",
      autorestart: true
    }
  ]
};
