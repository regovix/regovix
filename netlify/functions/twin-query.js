// netlify/functions/twin-query.js
// Phase 1 – RAG Query Handler
// Accepts a natural-language question, retrieves relevant chunks, calls Claude as the persona
//
// POST /api/twin-query
// Body: { query, userId, persona }

const Anthropic = require("@anthropic-ai/sdk");
const { Pinecone } = require("@pinecone-database/pinecone");
const { OpenAI } = require("openai");

// ─── Persona system prompt builder ───────────────────────────────────────────
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

STRICT RULES — follow these precisely:
1. Always answer in FIRST PERSON as ${name}. Never refer to yourself in the third person.
2. Draw your answers ONLY from the context documents provided below.
3. If the answer is not clearly supported by the context, respond with: "${fallback}"
4. Never fabricate facts, statistics, or regulatory references not found in the context.
5. Be CONCISE — imagine you are answering on a phone call. 2–4 sentences unless detail is critical.
6. Do NOT mention that you are an AI, a digital twin, or that you are referencing documents.
7. Do NOT use phrases like "Based on the provided context..." — just answer naturally.
8. If the question is about an emergency or immediate danger, always advise contacting emergency services first.

KNOWLEDGE BASE CONTEXT:
${chunks}

Answer the user's question based only on the above context.`;
}

// ─── Query embedding ──────────────────────────────────────────────────────────
async function embedQuery(query) {
  const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await oai.embeddings.create({
    model: "text-embedding-3-small",
    input: query,
  });
  return res.data[0].embedding;
}

// ─── Pinecone retrieval ───────────────────────────────────────────────────────
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
    chunkIndex: m.metadata.chunkIndex,
  }));
}

// ─── Handler ──────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const { query, userId, persona = {} } = JSON.parse(event.body || "{}");

    if (!query || !userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing required fields: query, userId" }),
      };
    }

    if (query.length > 2000) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Query too long (max 2000 characters)" }),
      };
    }

    // Step 1: Embed the query
    console.log(`[query] Embedding query for user: ${userId}`);
    const queryVec = await embedQuery(query);

    // Step 2: Retrieve top-5 chunks
    console.log(`[query] Retrieving chunks from Pinecone`);
    const matches = await retrieveChunks(queryVec, userId, 5);

    if (matches.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          answer: persona.fallback || "I don't have any relevant information indexed yet. Please upload some documents first.",
          sources: [],
          chunks: [],
          retrievedCount: 0,
        }),
      };
    }

    // Step 3: Build context string
    const contextString = matches
      .map((m, i) => `[Source ${i + 1}: ${m.source} | relevance: ${(m.score * 100).toFixed(0)}%]\n${m.text}`)
      .join("\n\n---\n\n");

    // Step 4: Call Claude with persona + context
    console.log(`[query] Calling Claude with ${matches.length} chunks`);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const msg = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: buildSystemPrompt(persona, contextString),
      messages: [{ role: "user", content: query }],
    });

    const answer = msg.content[0].text;

    // Deduplicate sources
    const sources = [...new Set(matches.map(m => m.source))];

    // Build usage stats
    const usage = {
      inputTokens: msg.usage.input_tokens,
      outputTokens: msg.usage.output_tokens,
      retrievedChunks: matches.length,
      topScore: matches[0]?.score?.toFixed(3),
    };

    console.log(`[query] Done. Answer: ${answer.substring(0, 80)}…`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        answer,
        sources,
        usage,
        // In dev/debug mode, include chunk details
        chunks: matches.map(m => ({
          source: m.source,
          score: m.score,
          preview: m.text.substring(0, 120) + "…",
        })),
      }),
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
