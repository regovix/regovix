// netlify/functions/avatar-session.js
// Phase 4 — HeyGen LiveAvatar (updated for 2025/2026 API)
// Gets a session token for the frontend SDK to use

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
    const { action, session_id, text, candidate, sdp_answer } = JSON.parse(event.body || "{}");

    // ── Get session token (frontend SDK needs this) ────────────────
    if (action === "get_token") {
      const res = await fetch("https://api.heygen.com/v1/streaming.create_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": process.env.HEYGEN_API_KEY,
        },
      });

      const data = await res.json();
      console.log("[avatar-session] get_token response:", JSON.stringify(data));

      if (!res.ok || !data.data?.token) {
        throw new Error(data.message || `HeyGen error: ${res.status}`);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ token: data.data.token }),
      };
    }

    // ── Speak text via REST (after session established by SDK) ─────
    if (action === "speak") {
      if (!session_id || !text) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing session_id or text" }) };
      }

      const res = await fetch("https://api.heygen.com/v1/streaming.task", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": process.env.HEYGEN_API_KEY,
        },
        body: JSON.stringify({ session_id, text, task_type: "talk" }),
      });

      const data = await res.json();
      console.log("[avatar-session] speak response:", JSON.stringify(data));
      if (!res.ok) throw new Error(data.message || `HeyGen error: ${res.status}`);

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // ── Stop session ───────────────────────────────────────────────
    if (action === "stop_session") {
      if (!session_id) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing session_id" }) };

      const res = await fetch("https://api.heygen.com/v1/streaming.stop", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": process.env.HEYGEN_API_KEY,
        },
        body: JSON.stringify({ session_id }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `HeyGen error: ${res.status}`);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown action: " + action }) };

  } catch (err) {
    console.error("[avatar-session] Error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};