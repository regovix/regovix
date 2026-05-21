// netlify/functions/phone-call.js
// Phase 3 — Twilio Phone Channel
// Handles inbound calls, transcribes speech, queries RAG, responds with TTS

const Anthropic = require("@anthropic-ai/sdk");
const { Pinecone } = require("@pinecone-database/pinecone");
const { OpenAI } = require("openai");

// ─── Persona (matches TwinCore dashboard) ────────────────────────────────────
const PERSONA = {
  name: "Madhu",
  role: "HSEQ Advisor",
  company: "Environmental Treatment Solutions",
  style: "professional, precise, and practical",
  fallback: "I'd need to look into that further before I can give you a definitive answer.",
  userId: "ets-madhu-twin",
};

// ─── RAG Query ────────────────────────────────────────────────────────────────
async function embedQuery(query) {
  const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await oai.embeddings.create({
    model: "text-embedding-3-small",
    input: query,
  });
  return res.data[0].embedding;
}

async function retrieveChunks(queryVec, topK) {
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const index = pc.index(process.env.PINECONE_INDEX || "twin-knowledge");
  const namespace = index.namespace(PERSONA.userId);
  const results = await namespace.query({
    vector: queryVec,
    topK: topK,
    includeMetadata: true,
    includeValues: false,
  });
  return results.matches.map(function(m) {
    return { text: m.metadata.text, source: m.metadata.source };
  });
}

async function generateAnswer(query, chunks) {
  var contextString = chunks.length > 0
    ? chunks.map(function(m, i) { return "[Source " + (i+1) + ": " + m.source + "]\n" + m.text; }).join("\n\n---\n\n")
    : "No relevant documents found.";

  var systemPrompt = "You are " + PERSONA.name + ", a " + PERSONA.role + " at " + PERSONA.company + ".\n" +
    "Your communication style is: " + PERSONA.style + ".\n\n" +
    "RULES:\n" +
    "1. Answer in first person as " + PERSONA.name + ".\n" +
    "2. Draw answers ONLY from the context provided.\n" +
    "3. If not in context, say: " + PERSONA.fallback + "\n" +
    "4. Never fabricate facts.\n" +
    "5. Keep answers SHORT — maximum 3 sentences. You are on a phone call.\n" +
    "6. Do NOT mention you are an AI.\n" +
    "7. Speak naturally as if having a conversation.\n\n" +
    "CONTEXT:\n" + contextString;

  var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  var msg = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: "user", content: query }],
  });
  return msg.content[0].text;
}

// ─── TwiML Helpers ────────────────────────────────────────────────────────────
function twimlResponse(text, gatherNextAction) {
  var gather = gatherNextAction
    ? `<Gather input="speech" action="/api/phone-transcribe" method="POST" speechTimeout="3" speechModel="phone_call" language="en-AU">
        <Say voice="Polly.Joanna">${escapeXml(text)}</Say>
      </Gather>
      <Redirect>/api/phone-call</Redirect>`
    : `<Say voice="Polly.Joanna">${escapeXml(text)}</Say>
       <Hangup/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${gather}
</Response>`;
}

function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─── Handler — Inbound call greeting ─────────────────────────────────────────
exports.handler = async function(event) {
  var headers = {
    "Content-Type": "text/xml",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    var greeting = "Hi, you've reached " + PERSONA.name + ", " + PERSONA.role + " at " + PERSONA.company + ". How can I help you today?";
    var twiml = twimlResponse(greeting, true);

    return { statusCode: 200, headers: headers, body: twiml };
  } catch (err) {
    console.error("[phone-call] Error:", err);
    var errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, there was a technical issue. Please try again later.</Say>
  <Hangup/>
</Response>`;
    return { statusCode: 200, headers: headers, body: errorTwiml };
  }
};