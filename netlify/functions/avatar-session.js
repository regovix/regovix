// netlify/functions/avatar-session.js
// LiveAvatar session token with custom LLM configuration

const LIVEAVATAR_API_URL = "https://api.liveavatar.com";
const AVATAR_ID = "64b526e4-741c-43b6-a918-4e40f3261c7a";
const CONTEXT_ID = "23eb8db4-b679-47bc-bf1c-850d1807288e";
const LLM_CONFIG_ID = "f5368b2b-a907-44c2-82fe-65f93e3e67d3";
const LIVEAVATAR_KEY = process.env.LIVEAVATAR_API_KEY;

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

    // ── Get session token with custom LLM ─────────────────────────
    if (action === "get_token") {
      const res = await fetch(`${LIVEAVATAR_API_URL}/v1/sessions/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": LIVEAVATAR_KEY,
        },
        body: JSON.stringify({
          avatar_id: AVATAR_ID,
          llm_configuration_id: LLM_CONFIG_ID,
          mode: "FULL",
        }),
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

    // ── Get embed URL (fallback) ───────────────────────────────────
    if (action === "get_embed") {
      const res = await fetch(`${LIVEAVATAR_API_URL}/v2/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": LIVEAVATAR_KEY,
        },
        body: JSON.stringify({
          avatar_id: AVATAR_ID,
          context_id: CONTEXT_ID,
          is_sandbox: false,
        }),
      });

      const data = await res.json();
      console.log("[avatar-session] get_embed response:", JSON.stringify(data));

      if (!res.ok || !data.data?.url) {
        throw new Error(data.message || `LiveAvatar error: ${res.status} ${JSON.stringify(data)}`);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ url: data.data.url }),
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown action: " + action }) };

  } catch (err) {
    console.error("[avatar-session] Error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
