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

async function sendMessage(userChatId, message, botName) {
  botName = botName || "Veasly小幫手";
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
