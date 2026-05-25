// netlify/functions/phone-call.js
// Phase 3 — Twilio Phone Channel
// Handles inbound calls and greets the caller

const PERSONA = {
  name: "Madhu",
  role: "CEO",
  company: "Regovix",
  style: "professional, helpful, and knowledgeable",
  fallback: "I'd need to look into that further before I can give you a definitive answer.",
  userId: "ets-madhu-twin",
};

function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

exports.handler = async function(event) {
  var headers = {
    "Content-Type": "text/xml",
    "Access-Control-Allow-Origin": "*",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    var greeting = "Hi, you have reached " + PERSONA.name + ", " + PERSONA.role + " at " + PERSONA.company + ". How can I help you today?";

    var twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="/api/phone-transcribe" method="POST" speechTimeout="3" speechModel="phone_call" language="en-AU">
    <Say voice="Polly.Matthew">${escapeXml(greeting)}</Say>
  </Gather>
  <Redirect>/api/phone-call</Redirect>
</Response>`;

    return { statusCode: 200, headers, body: twiml };

  } catch (err) {
    console.error("[phone-call] Error:", err);
    var errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">Sorry, there was a technical issue. Please try again later.</Say>
  <Hangup/>
</Response>`;
    return { statusCode: 200, headers, body: errorTwiml };
  }
};
