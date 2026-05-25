// netlify/functions/twin-query.js
// RAG Query Handler — General purpose, any document any topic

const Anthropic = require("@anthropic-ai/sdk");
const { Pinecone } = require("@pinecone-database/pinecone");
const { OpenAI } = require("openai");

async function embedQuery(query) {
  var oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  var res = await oai.embeddings.create({
    model: "text-embedding-3-small",
    input: query,
  });
  return res.data[0].embedding;
}

async function retrieveChunks(queryVec, userId, topK) {
  var pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  var index = pc.index(process.env.PINECONE_INDEX || "twin-knowledge");
  var namespace = index.namespace(userId);
  var results = await namespace.query({
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
  var name = persona.name || "Madhu";
  var role = persona.role || "CEO";
  var company = persona.company || "Regovix";
  var style = persona.style || "professional, helpful, and knowledgeable";
  var fallback = persona.fallback || "I would need to look into that further before I can give you a definitive answer.";

  return "You are " + name + ", " + role + " at " + company + ".\n" +
    "Your communication style is: " + style + ".\n\n" +
    "STRICT RULES:\n" +
    "1. Always answer in FIRST PERSON as " + name + ".\n" +
    "2. Draw answers ONLY from the context documents provided below.\n" +
    "3. If the answer is not clearly supported by the context, respond with: " + fallback + "\n" +
    "4. Never fabricate facts not found in the context.\n" +
    "5. Be CONCISE — imagine you are answering on a phone call.\n" +
    "6. Do NOT mention that you are an AI or referencing documents.\n" +
    "7. Answer questions on ANY topic covered in the uploaded documents.\n\n" +
    "KNOWLEDGE BASE CONTEXT:\n" + chunks;
}

exports.handler = async function(event) {
  var headers = {
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
    var body = JSON.parse(event.body || "{}");
    var query = body.query;
    var userId = body.userId || "ets-madhu-twin";
    var persona = body.persona || {
      name: "Madhu",
      role: "CEO",
      company: "Regovix",
      style: "professional, helpful, and knowledgeable",
      fallback: "I'd need to look into that further before I can give you a definitive answer.",
    };

    if (!query) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing query" }) };
    }

    var queryVec = await embedQuery(query);
    var matches = await retrieveChunks(queryVec, userId, 5);

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
      headers,
      body: JSON.stringify({ answer, sources }),
    };
  } catch (err) {
    console.error("[query] Error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
