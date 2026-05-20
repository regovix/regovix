// netlify/functions/twin-query.js
const Anthropic = require("@anthropic-ai/sdk");
const { Pinecone } = require("@pinecone-database/pinecone");
const { OpenAI } = require("openai");

function buildSystemPrompt(persona, chunks) {
  const {
    name = "Your Assistant",
    role = "Expert",
    company = "our organisation",
    style = "professional and helpful",
    fallback = "I'd need to look into that further before I can give you a definitive answer.",
  } = persona;

  return `You are ${name}, a ${role} at ${company}.
Your communication style is: ${style}.
STRICT RULES:
1. Always answer in FIRST PERSON as ${name}.
2. Draw answers ONLY from the context documents provided below.
3. If the answer is not clearly supported by the context, respond with: "${fallback}"
4. Never fabricate facts not found in the context.
5. Be CONCISE — imagine you are answering on a phone call.
6. Do NOT mention that you are an AI or referencing documents.
7. Do NOT use phrases like "Based on the provided context..."
8. If the question is about an emergency, always advise contacting emergency services first.

KNOWLEDGE BASE CONTEXT:
${chunks}`;
}

async function embedQuery(query) {
  const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await oai.embeddings.create({
    model: "text-embedding-3-small",
    input: query,
  });
  return res.data[0].embedding;
}

async function retrieveChunks(queryVec, userId, topK = 5) {
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const index = pc.index(process.env.PINECONE_INDEX || "twin-knowledge");
  const namespace = index.namespace(userId);
  const results = await namespace.query({
    vector: queryVec,
    topK,
    includeMetadata: true,
    includeValues: false,
  });
  return results.matches.map(m => ({
    text: m.metadata.text,
    source: m.metadata.source,
    score: m.score,
  }));
}

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { query, userId, persona = {} } = JSON.parse(event.body || "{}");

    if (!query || !userId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing query or userId" }) };
    }

    const queryVec = await embedQuery(query);
    const matches = await retrieveChunks(queryVec, userId, 5);

    if (matches.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          answer: persona.fallback || "I don't have relevant information indexed yet.",
          sources: [],
        }),
      };
    }

    const contextString = matches
      .map((m, i) => `[Source ${i + 1}: ${m.source}]\n${m.text}`)
      .join("\n\n---\n\n");

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: model: "claude-sonnet-4-5",
      max_tokens: 1000,
      system: buildSystemPrompt(persona, contextString),
      messages: [{ role: "user", content: query }],
    });

    const answer = msg.content[0].text;
    const sources = [...new Set(matches.map(m => m.source))];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ answer, sources }),
    };
  } catch (err) {
    console.error("[query] Error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};