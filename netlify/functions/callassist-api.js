// netlify/functions/callassist-api.js
// Secure proxy for CallAssist — keeps Anthropic API key off the browser

const Anthropic = require("@anthropic-ai/sdk");

exports.handler = async function(event) {
  var headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    var body = JSON.parse(event.body || "{}");
    var { model, max_tokens, system, messages } = body;

    if (!messages || !messages.length) {
      return { statusCode: 400, headers: headers, body: JSON.stringify({ error: "Missing messages" }) };
    }

    var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    var response = await client.messages.create({
      model: model || "claude-haiku-4-5",
      max_tokens: max_tokens || 1200,
      system: system,
      messages: messages,
    });

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify(response),
    };
  } catch (err) {
    console.error("[callassist-api] Error:", err);
    return {
      statusCode: 500,
      headers: headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};