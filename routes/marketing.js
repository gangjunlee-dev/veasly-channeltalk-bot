var express = require('express');
var router = express.Router();
var channeltalk = require('../lib/channeltalk');

// 캠페인 목록 조회
router.get('/campaigns', async function(req, res) {
  try {
    var limit = parseInt(req.query.limit) || 50;
    var result = await channeltalk.listCampaigns(limit);
    
    var campaigns = result.campaigns || [];
    var summary = campaigns.map(function(c) {
      return {
        id: c.id,
        name: c.name,
        state: c.state,
        createdAt: c.createdAt ? new Date(c.createdAt).toISOString().split('T')[0] : '',
        sentCount: c.sentCount || 0,
        viewCount: c.viewCount || 0,
        clickCount: c.clickCount || 0,
        goalCount: c.goalCount || 0
      };
    });

    res.json({ success: true, total: campaigns.length, campaigns: summary });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 캠페인 상세 조회
router.get('/campaigns/:id', async function(req, res) {
  try {
    var result = await channeltalk.getCampaign(req.params.id);
    res.json({ success: true, campaign: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 캠페인 유저 목록
router.get('/campaigns/:id/users', async function(req, res) {
  try {
    var state = req.query.state || 'sent';
    var result = await channeltalk.listCampaignUsers(req.params.id, state);
    res.json({ success: true, users: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 일회성 메시지 목록
router.get('/one-time-msgs', async function(req, res) {
  try {
    var limit = parseInt(req.query.limit) || 50;
    var result = await channeltalk.listOneTimeMessages(limit);
    
    var msgs = result.oneTimeMsgs || [];
    var summary = msgs.map(function(m) {
      return {
        id: m.id,
        name: m.name,
        state: m.state,
        createdAt: m.createdAt ? new Date(m.createdAt).toISOString().split('T')[0] : '',
        sentCount: m.sentCount || 0,
        viewCount: m.viewCount || 0,
        clickCount: m.clickCount || 0,
        goalCount: m.goalCount || 0
      };
    });

    res.json({ success: true, total: msgs.length, messages: summary });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 마케팅 종합 리포트
router.get('/report', async function(req, res) {
  try {
    var campaignData = await channeltalk.listCampaigns(50);
    var oneTimeMsgData = await channeltalk.listOneTimeMessages(50);

    var campaigns = campaignData.campaigns || [];
    var oneTimeMsgs = oneTimeMsgData.oneTimeMsgs || [];

    var totalSent = 0;
    var totalView = 0;
    var totalClick = 0;
    var totalGoal = 0;

    for (var i = 0; i < campaigns.length; i++) {
      totalSent += campaigns[i].sentCount || 0;
      totalView += campaigns[i].viewCount || 0;
      totalClick += campaigns[i].clickCount || 0;
      totalGoal += campaigns[i].goalCount || 0;
    }
    for (var j = 0; j < oneTimeMsgs.length; j++) {
      totalSent += oneTimeMsgs[j].sentCount || 0;
      totalView += oneTimeMsgs[j].viewCount || 0;
      totalClick += oneTimeMsgs[j].clickCount || 0;
      totalGoal += oneTimeMsgs[j].goalCount || 0;
    }

    var viewRate = totalSent > 0 ? Math.round((totalView / totalSent) * 100) : 0;
    var clickRate = totalView > 0 ? Math.round((totalClick / totalView) * 100) : 0;
    var goalRate = totalSent > 0 ? Math.round((totalGoal / totalSent) * 100) : 0;

    var report = '=== VEASLY 마케팅 캠페인 리포트 ===\n';
    report += '생성일: ' + new Date().toISOString().split('T')[0] + '\n\n';
    report += '--- 캠페인 현황 ---\n';
    report += '자동 캠페인: ' + campaigns.length + '개\n';
    report += '일회성 메시지: ' + oneTimeMsgs.length + '개\n\n';
    report += '--- 전체 성과 ---\n';
    report += '총 발송: ' + totalSent + '건\n';
    report += '총 조회: ' + totalView + '건 (조회율 ' + viewRate + '%)\n';
    report += '총 클릭: ' + totalClick + '건 (클릭율 ' + clickRate + '%)\n';
    report += '총 전환: ' + totalGoal + '건 (전환율 ' + goalRate + '%)\n\n';

    report += '--- 캠페인별 상세 ---\n';
    for (var k = 0; k < campaigns.length; k++) {
      var c = campaigns[k];
      var cViewRate = (c.sentCount || 0) > 0 ? Math.round(((c.viewCount || 0) / c.sentCount) * 100) : 0;
      var cClickRate = (c.viewCount || 0) > 0 ? Math.round(((c.clickCount || 0) / c.viewCount) * 100) : 0;
      report += '\n[' + (c.name || 'Campaign ' + c.id) + ']\n';
      report += '  상태: ' + (c.state || 'unknown') + '\n';
      report += '  발송: ' + (c.sentCount || 0) + ' / 조회: ' + (c.viewCount || 0) + ' (' + cViewRate + '%)';
      report += ' / 클릭: ' + (c.clickCount || 0) + ' (' + cClickRate + '%)\n';
    }

    if (oneTimeMsgs.length > 0) {
      report += '\n--- 일회성 메시지별 상세 ---\n';
      for (var l = 0; l < oneTimeMsgs.length; l++) {
        var m = oneTimeMsgs[l];
        var mViewRate = (m.sentCount || 0) > 0 ? Math.round(((m.viewCount || 0) / m.sentCount) * 100) : 0;
        report += '\n[' + (m.name || 'Message ' + m.id) + ']\n';
        report += '  발송: ' + (m.sentCount || 0) + ' / 조회: ' + (m.viewCount || 0) + ' (' + mViewRate + '%)\n';
      }
    }

    res.json({ success: true, report: report, raw: { campaigns: campaigns.length, oneTimeMsgs: oneTimeMsgs.length, totalSent: totalSent, totalView: totalView, totalClick: totalClick, totalGoal: totalGoal, viewRate: viewRate, clickRate: clickRate, goalRate: goalRate } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
