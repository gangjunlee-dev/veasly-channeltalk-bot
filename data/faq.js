var FAQ_DATABASE = [
  {
    id: 'SHIP_001',
    category: 'shipping',
    keywords: ['多久', '幾天', '到貨', '配送時間', '寄到', '幾時到', '什麼時候到', '出貨'],
    answer: 'VEASLY 配送時間說明：\n\n韓國處理：1~3個工作日\n國際運送＋通關：4~8個工作日\n台灣配送：1~3個工作日\n\n總計約 7~14 個工作日\n（韓國連假、促銷期間可能延長）\n\n需要查詢您的訂單狀態嗎？請提供您的訂單編號！',
    escalate: false
  },
  {
    id: 'SHIP_002',
    category: 'shipping',
    keywords: ['物流', '追蹤', '包裹', '貨態', '沒收到', '寄丟', 'tracking'],
    answer: '物流追蹤說明：\n\n韓國到台灣的國際運送期間（約5~10天）暫時無法追蹤，這是正常的！\n\n到達台灣後可透過以下方式追蹤：\n- 新竹物流：https://www.hct.com.tw/\n- UPS：https://www.ups.com/tw/\n- 全家超商：全家APP查詢\n\n若超過14個工作日仍未收到，請提供訂單編號！',
    escalate: false
  },
  {
    id: 'SHIP_003',
    category: 'shipping',
    keywords: ['超商', '全家', '取貨', '門市', '便利商店', '取件'],
    answer: '取貨方式說明：\n\n目前支援：\n- 全家超商取貨\n- 新竹物流宅配\n- UPS 配送\n\n下單時可選擇您偏好的收貨方式。全家取貨到店後會收到簡訊通知，請在7天內前往取件！',
    escalate: false
  },
  {
    id: 'SHIP_004',
    category: 'shipping',
    keywords: ['EZ WAY', 'ezway', '實名', '報關', '海關', '實名認證'],
    answer: 'EZ WAY 實名認證說明：\n\n所有從韓國寄到台灣的包裹都需要通過 EZ WAY 易利委 進行實名認證：\n\n1. 下載 EZ WAY 易利委 APP\n2. 完成實名註冊\n3. 收到報關推播通知後，點擊「申報確認」\n\n如果未完成確認，包裹可能會卡在海關！',
    escalate: false
  },
  {
    id: 'FEE_001',
    category: 'fee',
    keywords: ['運費', '費用', '多少錢', '怎麼算', '價格', '收費', '手續費', '關稅'],
    answer: 'VEASLY 費用說明：\n\n運費：根據預估重量計算，結帳時顯示\n實際重量：在韓國倉庫秤重後，多退少補\n大型物品：以材積重量計算\n最低計費：1公斤起\n\nVEASLY 已包含關稅！不額外收取！\n\n總費用 = 商品價格 + 韓國境內運費 + 國際運費 + 服務費',
    escalate: false
  },
  {
    id: 'PAY_001',
    category: 'payment',
    keywords: ['付款', '支付', '信用卡', '刷卡', 'PayPal', 'ATM', '轉帳', '怎麼付'],
    answer: 'VEASLY 支援的付款方式：\n\n- 信用卡/簽帳卡（VISA、MasterCard、JCB）\n- ATM 銀行轉帳\n- PayPal\n\n結帳過程中請勿離開頁面，否則點數或折扣碼可能會消失！如果不小心發生了，請在1個工作日內聯繫客服恢復。',
    escalate: false
  },
  {
    id: 'PAY_002',
    category: 'payment',
    keywords: ['付款失敗', '刷不過', '扣款', '錯誤', '無法付款', '交易失敗'],
    answer: '付款失敗解決方法：\n\n1. 確認信用卡額度是否足夠\n2. 確認卡片是否過期\n3. 嘗試其他付款方式\n4. 清除瀏覽器快取\n5. 換個瀏覽器或裝置試試\n\n仍然無法解決？請聯繫客服協助！',
    escalate: false
  },
  {
    id: 'CANCEL_001',
    category: 'cancel',
    keywords: ['取消', '退款', '退貨', '不要了', '取消訂單', '退錢'],
    answer: '取消與退款政策：\n\n全額退款：訂單「處理中」狀態可取消\n部分退款：韓國國內已發貨（扣除韓國退貨運費）\n無法取消：已進入國際運送 或 到貨超過7天\n\n退款原因（到貨7天內）：商品破損、與描述不符、疑似仿品（請提供照片）\n\n退款時間：全額3~5天 / 部分5~7天 / 問題商品5~10天\n\n需要申請嗎？請提供訂單編號！',
    escalate: false
  },
  {
    id: 'HOW_001',
    category: 'howto',
    keywords: ['怎麼用', '怎麼買', '教學', '如何', '使用', '步驟', '代購', '新手'],
    answer: 'VEASLY 使用方法：\n\n1. 複製韓國商品連結\n2. 到 www.veasly.com/tw 貼上連結\n3. 在 My Page 查看報價\n4. 確認後下單付款\n5. 完成 EZ WAY 實名認證\n6. 等待收貨\n\n支援 Coupang、Gmarket、11street、NAVER 等韓國主要購物平台！',
    escalate: false
  },
  {
    id: 'HOW_002',
    category: 'howto',
    keywords: ['閃電拍賣', 'BUNJANG', '二手', '中古'],
    answer: '閃電拍賣（BUNJANG）說明：\n\nVEASLY 與韓國最大二手平台 BUNJANG 合作！\n\n特色：韓國二手商品直購、VEASLY 代為驗證賣家、安全交易保障\n\n使用方式：到 www.veasly.com/tw/bunjang 瀏覽 → 選購 → 下單 → EZ WAY → 收貨\n\n二手商品為一點一物，看到喜歡的要快下手！',
    escalate: false
  },
  {
    id: 'POINT_001',
    category: 'points',
    keywords: ['點數', '折扣', '優惠', '折扣碼', '優惠碼', 'coupon', '折價'],
    answer: 'VEASLY 點數與折扣說明：\n\n點數：每筆訂單自動累積，結帳時可折抵最高 22% OFF！\n結帳時請勿離開頁面，否則點數會消失。\n\n折扣碼：結帳頁面輸入折扣碼欄位\n追蹤 Instagram @veasly.official 獲得最新折扣碼！',
    escalate: false
  },
  {
    id: 'POINT_002',
    category: 'points',
    keywords: ['點數不見', '折扣碼不見', '消失', '點數消失'],
    answer: '點數/折扣碼消失了？\n\n這通常是因為結帳過程中離開了頁面。\n\n解決方式：請在1個工作日內聯繫客服，提供：\n1. 您的帳號資訊\n2. 消失的點數數量或折扣碼\n3. 發生的時間\n\n我們會盡快為您恢復！',
    escalate: false
  },
  {
    id: 'ACCOUNT_001',
    category: 'account',
    keywords: ['密碼', '登入', '忘記密碼', '無法登入', '帳號', '重設'],
    answer: '帳號問題解決：\n\n忘記密碼：登入頁面 → 點擊「忘記密碼」→ 收取重設信件 → 設定新密碼\n\n網站異常：1. 先登出再重新登入 2. 清除瀏覽器快取 3. 換個瀏覽器或裝置\n\n仍有問題？請聯繫客服協助！',
    escalate: false
  },
  {
    id: 'CS_001',
    category: 'cs',
    keywords: ['客服', '聯繫', '聯絡', '真人', '人工', 'LINE', 'email'],
    answer: 'VEASLY 客服管道：\n\nChannel Talk（本對話窗）— 最快！\nLINE 官方帳號\nEmail 表單\n\n客服時間：週一至週五 營業時間內（韓國時間 KST）\n\nInstagram DM 不提供客服服務\n\n正在為您轉接真人客服，請稍候...',
    escalate: true
  },
  {
    id: 'ORDER_001',
    category: 'order',
    keywords: ['訂單', '查詢', '訂單狀態', '進度', '到哪了', '處理中', '狀態'],
    answer: '訂單狀態查詢方式：\n\n請登入 VEASLY 網站 → 我的頁面 → 訂單/配送狀態\nhttps://www.veasly.com/tw/my-page\n\n各狀態說明：\n- 結帳完成：已收到您的付款\n- 訂單處理中：正在韓國採購您的商品\n- 配送至集運倉：商品正送往韓國集運倉\n- 海外配送中：已從韓國出發前往台灣\n- 配送完成：已送達，請確認收貨\n\n如果狀態長時間沒有更新，請提供訂單編號，我們幫您確認！',
    escalate: false
  },
  {
    id: 'ORDER_002',
    category: 'order',
    keywords: ['沒有更新', '一直', '卡住', '好久', '很久', '等很久', '沒動', '沒變'],
    answer: '訂單狀態沒有更新？\n\n請先確認目前的狀態：\n\n- 「訂單處理中」→ 韓國賣場備貨中，通常1~3個工作日\n- 「配送至集運倉」→ 韓國國內物流配送中，通常1~3個工作日\n- 「海外配送中」→ 國際運送＋通關中，此階段約5~10天無法追蹤，這是正常的！\n\n若超過以下時間仍無更新，請聯繫客服：\n- 訂單處理中 超過5天\n- 海外配送中 超過14天\n\n請提供您的訂單編號，我們立即為您查詢！',
    escalate: false
  },
  {
    id: 'ORDER_003',
    category: 'order',
    keywords: ['報價', '報價請求', '商品頁面', '看不到', '無法下單', '過期'],
    answer: '報價相關說明：\n\n報價是什麼？\n您提供韓國商品連結或圖片 → VEASLY 建立商品頁面（含價格、運費、關稅等）→ 您確認後下單\n\n報價有效期：7天\n超過7天需重新提交報價請求\n\n無法下單？可能原因：\n- 報價已過期（超過7天）\n- 商品已售完\n- 頁面異常 → 換瀏覽器試試\n\n如需重新報價，請到 www.veasly.com/tw 提交商品連結！',
    escalate: false
  },
  {
    id: 'ORDER_004',
    category: 'order',
    keywords: ['購買證明', '發票', '收據', '報關發票'],
    answer: '購買證明/報關發票：\n\n結帳後 1~2 個工作日內會完成訂單確認並上傳購買憑證\n\n查看方式：我的頁面 → 訂單/配送狀態 → 點選該筆訂單\nhttps://www.veasly.com/tw/my-page\n\n若未看到購買憑證，請聯繫客服協助！',
    escalate: false
  },
  {
    id: 'GROUP_001',
    category: 'groupbuy',
    keywords: ['團購', '團購商品', '特價', '免運', '活動'],
    answer: 'VEASLY 團購活動：\n\n團購 = 期間限定特價＋免運機會！\n\n查看目前團購商品：\nhttps://www.veasly.com/tw/group-buying\n\n追蹤 Instagram @veasly.official 獲得最新團購通知！\n\n團購商品數量有限，要搶要快！',
    escalate: false
  },
  {
    id: 'PRICE_001',
    category: 'price',
    keywords: ['太貴', '價格高', '報價太高', '為什麼這麼貴', '比較貴'],
    answer: 'VEASLY 報價說明：\n\nVEASLY 的報價金額包含所有費用：\n商品價格 + 關稅 + 韓國國內運費 + 國際運費 + 代購手續費\n\n所以報價會比韓國網站上的商品原價高，這是正常的。\n\n價格差異的可能原因：\n- 優惠已結束或不適用\n- 原賣場缺貨，改用其他賣場報價\n- 匯率波動\n\n如有疑問，歡迎提供商品連結，我們可以重新為您確認！',
    escalate: false
  }
];

module.exports = { FAQ_DATABASE: FAQ_DATABASE };
