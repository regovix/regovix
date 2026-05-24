// netlify/functions/avatar-session.js
// Phase 4 — LiveAvatar API (liveavatar.com)

const LIVEAVATAR_API_URL = "https://api.liveavatar.com";

exports.handler = async function(event) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { action } = JSON.parse(event.body || "{}");

    // ── Get session token ─────────────────────────────────────────
    if (action === "get_token") {
      const res = await fetch(`${LIVEAVATAR_API_URL}/v1/sessions/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": process.env.LIVEAVATAR_API_KEY,
        },
      });

      const data = await res.json();
      console.log("[avatar-session] get_token response:", JSON.stringify(data));

      if (!res.ok || !data.data?.session_token) {
        throw new Error(data.message || `LiveAvatar error: ${res.status} ${JSON.stringify(data)}`);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ token: data.data.session_token }),
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown action: " + action }) };

  } catch (err) {
    console.error("[avatar-session] Error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};