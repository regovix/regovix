const Anthropic = require("@anthropic-ai/sdk");
const { Pinecone } = require("@pinecone-database/pinecone");
const { OpenAI } = require("openai");

async function embedQuery(query) {
  const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await oai.embeddings.create({
    model: "text-embedding-3-small",
    input: query,
  });
  return res.data[0].embedding;
}

async function retrieveChunks(queryVec, userId, topK) {
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const index = pc.index(process.env.PINECONE_INDEX || "twin-knowledge");
  const namespace = index.namespace(userId);
  const results = await namespace.query({
    vector: queryVec,
    topK: topK,
    includeMetadata: true,
    includeValues: false,
  });
  return results.matches.map(function(m) {
    return { text: m.metadata.text, source: m.metadata.source, score: m.score };
  });
}

function buildSystemPrompt(persona, chunks) {
  var name = persona.name || "Your Assistant";
  var role = persona.role || "Expert";
  var company = persona.company || "our organisation";
  var style = persona.style || "professional and helpful";
  var fallback = persona.fallback || "I would need to look into that further before I can give you a definitive answer.";
  return "You are " + name + ", a " + role + " at " + company + ".\n" +
    "Your communication style is: " + style + ".\n\n" +
    "STRICT RULES:\n" +
    "1. Always answer in FIRST PERSON as " + name + ".\n" +
    "2. Draw answers ONLY from the context documents provided below.\n" +
    "3. If the answer is not clearly supported by the context, respond with: " + fallback + "\n" +
    "4. Never fabricate facts not found in the context.\n" +
    "5. Be CONCISE - imagine you are answering on a phone call.\n" +
    "6. Do NOT mention that you are an AI or referencing documents.\n\n" +
    "KNOWLEDGE BASE CONTEXT:\n" + chunks;
}

exports.handler = async function(event) {
  var headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    var body = JSON.parse(event.body || "{}");
    var query = body.query;
    var userId = body.userId;
    var persona = body.persona || {};

    if (!query || !userId) {
      return { statusCode: 400, headers: headers, body: JSON.stringify({ error: "Missing query or userId" }) };
    }

    var queryVec = await embedQuery(query);
    var matches = await retrieveChunks(queryVec, userId, 5);

    if (matches.length === 0) {
      return {
        statusCode: 200,
        headers: headers,
        body: JSON.stringify({
          answer: persona.fallback || "I don't have relevant information indexed yet.",
          sources: [],
        }),
      };
    }

    var contextString = matches.map(function(m, i) {
      return "[Source " + (i+1) + ": " + m.source + "]\n" + m.text;
    }).join("\n\n---\n\n");

    var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    var msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1000,
      system: buildSystemPrompt(persona, contextString),
      messages: [{ role: "user", content: query }],
    });

    var answer = msg.content[0].text;
    var sources = [];
    matches.forEach(function(m) {
      if (sources.indexOf(m.source) === -1) sources.push(m.source);
    });

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({ answer: answer, sources: sources }),
    };
  } catch (err) {
    console.error("[query] Error:", err);
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: err.message }) };
  }
};