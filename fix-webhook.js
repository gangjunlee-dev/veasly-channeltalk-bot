require('dotenv').config();
var channeltalk = require('./lib/channeltalk');
var axios = require('axios');

var client = axios.create({
  baseURL: "https://api.channel.io/open/v5",
  headers: {
    "Content-Type": "application/json",
    "x-access-key": process.env.CHANNEL_ACCESS_KEY,
    "x-access-secret": process.env.CHANNEL_ACCESS_SECRET
  }
});

async function run() {
  console.log("=== 웹훅 scope 수정 시작 ===");
  var list = await channeltalk.listWebhooks();
  var webhooks = list.webhooks || [];
  var current = webhooks[0];
  console.log("현재 ID:", current.id, "| scopes:", current.scopes.length);

  console.log("기존 웹훅 삭제...");
  await channeltalk.deleteWebhook(current.id);
  console.log("삭제 완료");

  var result = await client.post("/webhooks", {
    name: "VeaslyBot-V2",
    url: current.url,
    scopes: [
      "message.created.userChat",
      "message.created.teamChat",
      "userChat.opened",
      "userChat.closed",
      "userChat.updated",
      "member.upserted.contact",
      "member.upserted.subscription",
      "member.deleted",
      "lead.upserted.contact",
      "lead.upserted.subscription",
      "lead.deleted"
    ]
  });

  console.log("새 웹훅 생성 완료");
  var verify = await channeltalk.listWebhooks();
  var nw = (verify.webhooks || [])[0];
  if (nw) {
    console.log("새 ID:", nw.id);
    console.log("userChat.closed:", nw.scopes.indexOf("userChat.closed") > -1 ? "OK" : "MISSING");
    console.log("userChat.updated:", nw.scopes.indexOf("userChat.updated") > -1 ? "OK" : "MISSING");
    console.log("전체 scopes:", nw.scopes.join(", "));
  }
}
run().catch(function(e) { console.error("에러:", e.response ? e.response.data : e.message); });
