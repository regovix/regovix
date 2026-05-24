// netlify/functions/avatar-session.js
// Phase 4 — HeyGen Streaming Avatar
// Creates and manages HeyGen streaming sessions for live video avatar

const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;
const AVATAR_ID = "bec00a33ca344019a2ffabac003ca572";
const VOICE_ID = "LKI0cvTlTIQsIjKd0UtX";
const HEYGEN_API_URL = "https://api.heygen.com";

exports.handler = async function(event) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { action, session_id, text } = JSON.parse(event.body || "{}");

    // ── Action: Create new streaming session ──────────────────────
    if (action === "create_session") {
      const res = await fetch(`${HEYGEN_API_URL}/v1/streaming.new`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": HEYGEN_API_KEY,
        },
        body: JSON.stringify({
          avatar_id: AVATAR_ID,
          voice: { voice_id: VOICE_ID },
          quality: "medium",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || `HeyGen error: ${res.status}`);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          session_id: data.data.session_id,
          sdp: data.data.sdp,
          ice_servers: data.data.ice_servers,
        }),
      };
    }

    // ── Action: Start session ─────────────────────────────────────
    if (action === "start_session") {
      if (!session_id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing session_id" }) };
      }

      const { sdp_answer } = JSON.parse(event.body);

      const res = await fetch(`${HEYGEN_API_URL}/v1/streaming.start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": HEYGEN_API_KEY,
        },
        body: JSON.stringify({
          session_id,
          sdp: sdp_answer,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `HeyGen error: ${res.status}`);

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // ── Action: Send ICE candidate ────────────────────────────────
    if (action === "ice_candidate") {
      const { candidate } = JSON.parse(event.body);

      const res = await fetch(`${HEYGEN_API_URL}/v1/streaming.ice`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": HEYGEN_API_KEY,
        },
        body: JSON.stringify({ session_id, candidate }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `HeyGen error: ${res.status}`);

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // ── Action: Speak text ────────────────────────────────────────
    if (action === "speak") {
      if (!session_id || !text) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing session_id or text" }) };
      }

      const res = await fetch(`${HEYGEN_API_URL}/v1/streaming.task`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": HEYGEN_API_KEY,
        },
        body: JSON.stringify({
          session_id,
          text,
          task_type: "talk",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `HeyGen error: ${res.status}`);

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, task_id: data.data?.task_id }) };
    }

    // ── Action: Stop session ──────────────────────────────────────
    if (action === "stop_session") {
      if (!session_id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing session_id" }) };
      }

      const res = await fetch(`${HEYGEN_API_URL}/v1/streaming.stop`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": HEYGEN_API_KEY,
        },
        body: JSON.stringify({ session_id }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `HeyGen error: ${res.status}`);

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown action" }) };

  } catch (err) {
    console.error("[avatar-session] Error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};