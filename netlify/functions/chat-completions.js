// netlify/functions/chat-completions.js
// OpenAI-compatible chat completions endpoint for LiveAvatar custom LLM
// LiveAvatar calls POST /api/chat-completions with OpenAI format
// We intercept, run RAG query, return OpenAI-format response

const Anthropic = require("@anthropic-ai/sdk");
const { Pinecone } = require("@pinecone-database/pinecone");
const { OpenAI } = require("openai");

const PERSONA = {
  name: "Madhu",
  role: "CEO",
  company: "Regovix",
  style: "professional, helpful, and knowledgeable",
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
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const body = JSON.parse(event.body || "{}");
    const messages = body.messages || [];

    // Extract the last user message
    const lastUserMsg = messages.filter(m => m.role === "user").pop();
    const query = lastUserMsg ? lastUserMsg.content : "";

    console.log("[chat-completions] Query received:", query);

    if (!query) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          id: "chatcmpl-" + Date.now(),
          object: "chat.completion",
          model: "twincore-rag",
          choices: [{
            index: 0,
            message: { role: "assistant", content: PERSONA.fallback },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }),
      };
    }

    // Run RAG pipeline
    const queryVec = await embedQuery(query);
    const chunks = await retrieveChunks(queryVec, 5);

    const contextString = chunks.length > 0
      ? chunks.map((m, i) => `[Source ${i + 1}: ${m.source}]\n${m.text}`).join("\n\n---\n\n")
      : "No relevant documents found.";

    const systemPrompt = `You are ${PERSONA.name}, ${PERSONA.role} at ${PERSONA.company}.
Your communication style is: ${PERSONA.style}.

CRITICAL RULES — you are speaking in a live video call:
1. Answer in first person as ${PERSONA.name}.
2. Draw answers ONLY from the context documents provided.
3. If not in context: "${PERSONA.fallback}"
4. Keep answers to 2-3 sentences MAXIMUM — you are on a live video call.
5. Speak naturally and conversationally — no bullet points or lists.
6. Do NOT mention you are an AI or referencing documents.
7. Answer questions on ANY topic covered in the uploaded documents.

KNOWLEDGE BASE CONTEXT:
${contextString}`;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: "user", content: query }],
    });

    const answer = msg.content[0].text;
    console.log("[chat-completions] Answer:", answer.substring(0, 80));

    // Return in OpenAI format — required by LiveAvatar
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        id: "chatcmpl-" + Date.now(),
        object: "chat.completion",
        model: "twincore-rag",
        choices: [{
          index: 0,
          message: { role: "assistant", content: answer },
          finish_reason: "stop",
        }],
        usage: {
          prompt_tokens: msg.usage.input_tokens,
          completion_tokens: msg.usage.output_tokens,
          total_tokens: msg.usage.input_tokens + msg.usage.output_tokens,
        },
      }),
    };

  } catch (err) {
    console.error("[chat-completions] Error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};