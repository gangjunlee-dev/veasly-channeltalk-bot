var axios = require("axios");
var BASE_URL = "https://api.channel.io/open/v5";

var client = axios.create({
  baseURL: BASE_URL,
  headers: {
    "Content-Type": "application/json",
    "x-access-key": process.env.CHANNEL_ACCESS_KEY,
    "x-access-secret": process.env.CHANNEL_ACCESS_SECRET
  }
});

async function createBot(name, avatarUrl, color) {
  var res = await client.post("/bots", { name: name, avatarUrl: avatarUrl, color: color });
  return res.data;
}

async function listBots() {
  var res = await client.get("/bots");
  return res.data;
}

// [SOP v2 §4] 봇 발신 메시지에서 이모지 제거 (문서 v2 톤 통일)
function stripEmoji(s) {
  if (typeof s !== 'string' || !s) return s;
  return s
    .replace(/[\u{1F000}-\u{1FAFF}]/gu, '')      // pictographs·flags 등
    .replace(/[\u{2600}-\u{27BF}]/gu, '')        // ☀⚠✈✅❌ 등
    .replace(/[\u{2B00}-\u{2BFF}]/gu, '')        // ⭐ 등
    .replace(/[\u{23E9}-\u{23FA}]/gu, '')        // ⏰⏳ 등
    .replace(/[\u{FE0F}\u{20E3}\u{200D}]/gu, '') // variation selector·keycap·ZWJ
    .replace(/[ \t]{2,}/g, ' ');
}

async function sendMessage(userChatId, message, botName) {
  botName = botName || "Veasly小幫手";
  // [SOP v2] 이모지 제거 (링크 sanitize 전에 수행)
  if (message && message.blocks) { message.blocks.forEach(function(b) { if (b.value && typeof b.value === "string") { b.value = stripEmoji(b.value); } }); }
  // Sanitize angle brackets to prevent ChannelTalk 422 parse error
  if (message && message.blocks) { message.blocks.forEach(function(b) { if (b.value && typeof b.value === "string") { b.value = b.value.replace(/<link type="url">/g, "{{LINK_OPEN}}").replace(/<\/link>/g, "{{LINK_CLOSE}}").replace(/</g, "\uFF1C").replace(/>/g, "\uFF1E").replace(/{{LINK_OPEN}}/g, '<link type="url">').replace(/{{LINK_CLOSE}}/g, "</link>"); } }); }
  var url = "/user-chats/" + userChatId + "/messages?botName=" + encodeURIComponent(botName);
  var res = await client.post(url, message);
  return res.data;
}

async function getChatMessages(userChatId, limit) {
  limit = limit || 25;
  var res = await client.get("/user-chats/" + userChatId + "/messages?limit=" + limit);
  return res.data;
}

async function listUserChats(state, limit) {
  state = state || "opened";
  limit = limit || 50;
  var res = await client.get("/user-chats?state=" + state + "&limit=" + limit);
  return res.data;
}

async function closeChat(userChatId, botName) {
  botName = botName || "Veasly小幫手";
  var res = await client.patch("/user-chats/" + userChatId + "/close?botName=" + encodeURIComponent(botName));
  return res.data;
}

async function inviteManager(userChatId, managerIds, botName) {
  botName = botName || "Veasly小幫手";
  var ids = Array.isArray(managerIds) ? managerIds.join(",") : managerIds;
  var url = "/user-chats/" + userChatId + "/invite?botName=" + encodeURIComponent(botName) + "&managerIds=" + ids;
  var res = await client.patch(url);
  return res.data;
}

async function addFollowers(userChatId, managerIds) {
  var ids = Array.isArray(managerIds) ? managerIds : [managerIds];
  var res = await client.patch("/user-chats/" + userChatId, { followerManagerIds: ids });
  return res.data;
}
async function getUser(userId) {
  var res = await client.get("/users/" + userId);
  return res.data;
}

async function getUserByMemberId(memberId) {
  var res = await client.get("/users/@" + memberId);
  return res.data;
}

async function updateUser(userId, profile) {
  var res = await client.patch("/users/" + userId, { profile: profile });
  return res.data;
}

async function upsertUser(memberId, profile) {
  var res = await client.put("/users/@" + memberId, { profile: profile });
  return res.data;
}

async function createUserChat(userId) {
  var res = await client.post("/users/" + userId + "/user-chats");
  return res.data;
}

async function createEvent(userId, eventName, properties) {
  properties = properties || {};
  var res = await client.post("/users/" + userId + "/events", { name: eventName, property: properties });
  return res.data;
}

async function blockUser(userId) {
  var res = await client.post("/users/" + userId + "/block");
  return res.data;
}

async function listManagers() {
  var res = await client.get("/managers");
  return res.data;
}

// 상담 태그 부여 — SOP §4 넘김 체계(「직원 처리 불가」) 흡수용 (best-effort)
async function addChatTags(userChatId, tags) {
  var res = await client.put("/user-chats/" + userChatId + "/tags", { tags: tags });
  return res.data;
}

async function sendGroupMessage(groupId, message, botName) {
  botName = botName || "Veasly小幫手";
  var res = await client.post("/groups/" + groupId + "/messages?botName=" + encodeURIComponent(botName), message);
  return res.data;
}

async function listGroups(limit) {
  limit = limit || 50;
  var res = await client.get("/groups?limit=" + limit);
  return res.data;
}

async function createWebhook(name, url) {
  var res = await client.post("/webhooks", { name: name, url: url });
  return res.data;
}

async function listWebhooks() {
  var res = await client.get("/webhooks");
  return res.data;
}

async function deleteWebhook(webhookId) {
  var res = await client.delete("/webhooks/" + webhookId);
  return res.data;
}

async function listCampaigns(limit) {
  limit = limit || 50;
  var res = await client.get("/mkt/campaigns?limit=" + limit);
  return res.data;
}

async function getCampaign(campaignId) {
  var res = await client.get("/mkt/campaigns/" + campaignId);
  return res.data;
}

async function listCampaignUsers(campaignId, state) {
  state = state || "sent";
  var res = await client.get("/mkt/campaigns/" + campaignId + "/campaign-users?state=" + state);
  return res.data;
}

async function listOneTimeMessages(limit) {
  limit = limit || 50;
  var res = await client.get("/mkt/one-time-msgs?limit=" + limit);
  return res.data;
}

module.exports = {
  createBot: createBot,
  listBots: listBots,
  sendMessage: sendMessage,
  getChatMessages: getChatMessages,
  listUserChats: listUserChats,
  closeChat: closeChat,
  inviteManager: inviteManager,
  addFollowers: addFollowers,
  addChatTags: addChatTags,
  getUser: getUser,
  getUserByMemberId: getUserByMemberId,
  updateUser: updateUser,
  upsertUser: upsertUser,
  createUserChat: createUserChat,
  createEvent: createEvent,
  blockUser: blockUser,
  listManagers: listManagers,
  sendGroupMessage: sendGroupMessage,
  listGroups: listGroups,
  createWebhook: createWebhook,
  listWebhooks: listWebhooks,
  deleteWebhook: deleteWebhook,
  listCampaigns: listCampaigns,
  getCampaign: getCampaign,
  listCampaignUsers: listCampaignUsers,
  listOneTimeMessages: listOneTimeMessages
};
