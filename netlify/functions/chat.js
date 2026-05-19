// ── Regovix AI Chat — Netlify Serverless Function ──────────────
// Location: netlify/functions/chat.js

const https = require('https');

const SYSTEM_PROMPT = "You are the Regovix website assistant. Regovix is an Australian HSEQ compliance SaaS platform built by Madhu Pattarambil, a practising HSEQ Advisor based in Sydney NSW. ABN: 19 735 810 326.\n\nAPPS AND PRICING:\n1. RiskMatrix $29/mo — visual risk matrix, 5x5 scoring, AI controls, PDF export\n2. RiskReady $69/mo — full risk assessment and SWMS builder, digital sign-off, all 19 HRCW categories\n3. InductGuard $49/mo — contractor induction portal, licence expiry tracking\n4. ToolboxGen $39/mo — AI toolbox talk generator, digital attendance register\n5. IncidentLoop $49/mo — incident and near miss reporting, corrective actions, PDF reports\n6. FleetCheck $59/mo — vehicle pre-start inspections, defect escalation\n7. ChemTrack $59/mo — chemical register, SDS management, AI hazard extraction\n8. AuditMate $69/mo — mobile site inspections, NCR tracking, PDF audit reports\n9. WellnessCheck $79/mo — pre-shift fatigue and FFD check-in, HVNL compliance\n10. ComplianceVault $59/mo — document control, expiry alerts, version history\n11. DGVault $89/mo — dangerous goods stock, ADG Code 9th Ed segregation checking\n12. RegWatchAI — real-time Australian regulatory change monitoring powered by Claude AI. Tracks SafeWork NSW, Safe Work Australia, ADG Code, EPA NSW, NHVR/HVNL, and AS/NZS Standards. Plans: Add-On $49/mo (for existing Regovix customers), Standalone $99/mo, Consultant $149/mo (up to 15 client dashboards + white-label reports). Free demo available instantly at regowatchai.netlify.app — no login or key needed. For full live AI monitoring, subscribe via regovix.com.au\n\nCALLASSIST (separate white-label product): Starter $299/mo, Professional $599/mo, Managed custom pricing.\n\nBUNDLES:\n- Safety Essentials $199/mo (RiskMatrix + IncidentLoop + ToolboxGen + FleetCheck)\n- Risk & Compliance $249/mo (RiskMatrix + RiskReady + InductGuard + AuditMate + ComplianceVault)\n- Chemical & DG $179/mo (ChemTrack + DGVault + IncidentLoop)\n- Growth Bundle $299/mo (any 5 apps)\n- Consultant Plan $449/mo (all 11 apps + white-label + 15 client companies)\n- Full Bundle $749/mo (all 11 apps — save $312/mo)\nAnnual plans: 10 months price for 12 months access.\n\nFREE TRIAL: Every app has a free 21-day trial, no credit card. Madhu personally sets up each trial within 1 business day. Visitors fill in the contact form at regovix.com.au.\n\nCONTACT: maddypat@regovix.com.au — responds within 1 business day.\n\nTONE: Be friendly, warm, and Australian. Keep replies under 120 words. Be specific and helpful. For RegWatchAI specifically, always direct visitors to try the FREE DEMO at regowatchai.netlify.app first — it works instantly with no login. For all other apps, direct to the contact form. Never make up features or prices not listed above."

function callAnthropic(apiKey, messages) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: messages.slice(-20)
    });

    var options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    };

    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Parse error')); }
      });
    });

    req.on('error', function(e) { reject(e); });
    req.write(body);
    req.end();
  });
}

exports.handler = async function(event) {
  var headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  var apiKey = process.env.ANTHROPIC_API_KEY || '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';

  if (!apiKey || apiKey.length < 20) {
    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({ reply: "Chat is setting up. Please email maddypat@regovix.com.au or use the contact form and Madhu will respond within 1 business day." })
    };
  }

  try {
    var body = JSON.parse(event.body || '{}');
    var messages = body.messages;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Invalid request' }) };
    }

    var data = await callAnthropic(apiKey, messages);
    var reply = (data.content && data.content[0]) ? data.content[0].text : "Please email maddypat@regovix.com.au directly.";

    return { statusCode: 200, headers: headers, body: JSON.stringify({ reply: reply }) };

  } catch(err) {
    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({ reply: "Sorry, something went wrong. Please email maddypat@regovix.com.au or use the contact form on this page." })
    };
  }
};
