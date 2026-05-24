// netlify/functions/avatar-query.js
// Phase 4 — RAG query for video avatar
// Same as twin-query but optimised for short spoken responses

const Anthropic = require("@anthropic-ai/sdk");
const { Pinecone } = require("@pinecone-database/pinecone");
const { OpenAI } = require("openai");

const PERSONA = {
  name: "Madhu",
  role: "CEO",
  company: "Regovix",
  style: "professional, warm, and conversational",
  fallback: "I'd need to look into that further before I can give you a definitive answer.",
  userId: "ets-madhu-twin",
};

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
    topK,
    includeMetadata: true,
    includeValues: false,
  });
  return results.matches.map(m => ({
    text: m.metadata.text,
    source: m.metadata.source,
  }));
}

exports.handler = async function(event) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const { query } = JSON.parse(event.body || "{}");

    if (!query) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing query" }) };
    }

    const queryVec = await embedQuery(query);
    const chunks = await retrieveChunks(queryVec, 5);

    const contextString = chunks.length > 0
      ? chunks.map((m, i) => `[Source ${i + 1}: ${m.source}]\n${m.text}`).join("\n\n---\n\n")
      : "No relevant documents found.";

    const systemPrompt = `You are ${PERSONA.name}, ${PERSONA.role} at ${PERSONA.company}.
Your communication style is: ${PERSONA.style}.

CRITICAL RULES FOR VIDEO RESPONSE:
1. Answer in first person as ${PERSONA.name}.
2. Draw answers ONLY from the context provided.
3. If not in context: "${PERSONA.fallback}"
4. Keep answers to 2-3 sentences MAXIMUM — you are speaking on video.
5. Speak naturally and conversationally — no bullet points or lists.
6. Do NOT mention you are an AI or referencing documents.
7. Sound warm and human — this is a face to face video conversation.

CONTEXT:
${contextString}`;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: "user", content: query }],
    });

    const answer = msg.content[0].text;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ answer, sources: chunks.map(c => c.source) }),
    };

  } catch (err) {
    console.error("[avatar-query] Error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};