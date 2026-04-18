export default {
  async fetch(request) {
    const TUNNEL_URL = "https://league-curious-weblog-busy.trycloudflare.com";
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
