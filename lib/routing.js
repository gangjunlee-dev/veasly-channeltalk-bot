/**
 * SOP v2 행동 규칙 (라우팅) — 시스템 최상위 우선순위
 *
 * 1. 신고금액(申報金額/報關金額/海關申報) 문의: 어떤 설명·확인·추측도 하지 않고
 *    고정 응답 후 상담원 핸드오프. (이유를 한 줄이라도 설명하면 실패)
 * 2. 분쟁 키워드(詐騙·詐欺·消保官·律師·爆料·檢舉·提告): 내용에 대한 답변·반박 없이
 *    즉시 상담원 핸드오프.
 */

var DISPUTE_KEYWORDS = [
  '詐騙', '詐欺', '消保官', '律師', '爆料', '檢舉', '提告',
  '诈骗', '诈欺', '律师', '检举'
];

// 고정 문구 (SOP v2 §3 — 그대로 사용, 수정 금지)
var DISPUTE_REPLY = '這部分會由專人盡快與您聯繫，請稍候。';
var DECLARED_AMOUNT_REPLY = '關於申報金額的部分，我們幫您向負責同事確認後回覆您。';

function isDisputeMessage(text) {
  if (!text) return false;
  for (var i = 0; i < DISPUTE_KEYWORDS.length; i++) {
    if (text.indexOf(DISPUTE_KEYWORDS[i]) !== -1) return true;
  }
  return false;
}

function isDeclaredAmountInquiry(text) {
  if (!text) return false;
  // 명시적 신고'금액' 용어만 무조건 참.
  // [2026-07-27 FIX6c] 海關申報/海关申报 를 이 목록에서 제외했다. 이건 '통관 신고(행위)'를 뜻하지
  //   금액을 묻는 말이 아니어서, 「海關申報需要我做什麼嗎」(절차 질문)까지 고정문구+핸드오프로
  //   빠지고 있었다. 금액을 묻는 경우엔 아래 hasTerm+hasMoneyContext 로 여전히 잡힌다.
  if (/申報金額|報關金額|申报金额|报关金额/.test(text)) return true;
  // 申報/報關 + 금액 문맥 (통관 절차·소요기간 일반 문의는 제외)
  var hasTerm = /申報|申报|報關|报关/.test(text);
  // [2026-07-27 FIX6c] 금액 문맥을 좁혔다.
  //   이전: /金額|金额|多少|價|价|便宜|少|低|高/ — 단독 '少'·'高'·'低' 와 시간을 묻는 '多少' 까지 걸려
  //   「請問報關要多少天？」(소요기간) 같은 질문이 신고금액 문의로 오판됐다('高'는 高雄에도 매칭).
  //   이제 '多少' 는 뒤에 시간·기간 단위가 오지 않을 때만 금액 문맥으로 본다.
  var hasMoneyContext = /金額|金额|價|价|便宜|多少(?!\s*(天|日|時間|时间|工作天|個工作天|个工作天|久|週|周|小時|小时))/.test(text);
  return hasTerm && hasMoneyContext;
}

module.exports = {
  isDisputeMessage: isDisputeMessage,
  isDeclaredAmountInquiry: isDeclaredAmountInquiry,
  DISPUTE_REPLY: DISPUTE_REPLY,
  DECLARED_AMOUNT_REPLY: DECLARED_AMOUNT_REPLY
};
