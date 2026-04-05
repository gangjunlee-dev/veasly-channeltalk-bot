var faqData = require("../data/faq");
var FAQ_DATABASE = faqData.FAQ_DATABASE;

function findBestMatch(userMessage) {
  if (!userMessage || typeof userMessage !== "string") return null;
  var normalizedMsg = userMessage.toLowerCase().trim();
  var bestMatch = null;
  var highestScore = 0;

  for (var i = 0; i < FAQ_DATABASE.length; i++) {
    var faq = FAQ_DATABASE[i];
    var score = 0;
    for (var j = 0; j < faq.keywords.length; j++) {
      if (normalizedMsg.includes(faq.keywords[j].toLowerCase())) {
        score += faq.keywords[j].length;
      }
    }
    if (score > highestScore) {
      highestScore = score;
      bestMatch = faq;
    }
  }

  if (highestScore < 2) return null;
  return bestMatch;
}

module.exports = { findBestMatch: findBestMatch };
