// netlify/functions/ingest-document.js
const Anthropic = require("@anthropic-ai/sdk");
const { Pinecone } = require("@pinecone-database/pinecone");
const { OpenAI } = require("openai");

async function extractText(fileBase64, fileType) {
  const buffer = Buffer.from(fileBase64, "base64");

  if (fileType === "txt" || fileType === "md") {
    return buffer.toString("utf-8");
  }

  if (fileType === "pdf") {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: model: "claude-sonnet-4-5",
      max_tokens: 4000,
      messages: [{
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: fileBase64 },
          },
          {
            type: "text",
            text: "Extract all text from this document. Return only the raw text content, preserving paragraph breaks with double newlines. Do not add any commentary.",
          },
        ],
      }],
    });
    return msg.content[0].text;
  }

  if (fileType === "docx") {
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  throw new Error(`Unsupported file type: ${fileType}`);
}

function chunkText(text, chunkSize = 512, overlap = 100) {
  const words = text.split(/\s+/);
  const chunks = [];
  let start = 0;

  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length);
    const chunk = words.slice(start, end).join(" ");
    if (chunk.trim().length > 20) {
      chunks.push(chunk.trim());
    }
    if (end >= words.length) break;
    start = end - overlap;
  }
  return chunks;
}

async function embedChunks(chunks) {
  const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const allEmbeddings = [];
  for (let i = 0; i < chunks.length; i += 100) {
    const batch = chunks.slice(i, i + 100);
    const res = await oai.embeddings.create({
      model: "text-embedding-3-small",
      input: batch,
    });
    allEmbeddings.push(...res.data.map(d => d.embedding));
  }
  return allEmbeddings;
}

async function upsertToPinecone(chunks, embeddings, userId, fileName, docId) {
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const index = pc.index(process.env.PINECONE_INDEX || "twin-knowledge");
  const namespace = index.namespace(userId);

  const vectors = chunks.map((chunk, i) => ({
    id: `${docId}_chunk_${i}`,
    values: embeddings[i],
    metadata: {
      text: chunk,
      source: fileName,
      docId,
      chunkIndex: i,
      userId,
      createdAt: new Date().toISOString(),
    },
  }));

  for (let i = 0; i < vectors.length; i += 100) {
    await namespace.upsert(vectors.slice(i, i + 100));
  }
  return vectors.length;
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
    const { fileName, fileType, fileBase64, userId } = JSON.parse(event.body || "{}");

    if (!fileName || !fileType || !fileBase64 || !userId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required fields" }) };
    }

    const docId = `doc_${userId}_${Date.now()}`;
    const rawText = await extractText(fileBase64, fileType);

    if (!rawText || rawText.length < 20) {
      return { statusCode: 422, headers, body: JSON.stringify({ error: "Could not extract text from file" }) };
    }

    const chunks = chunkText(rawText, 512, 100);
    const embeddings = await embedChunks(chunks);
    const upsertedCount = await upsertToPinecone(chunks, embeddings, userId, fileName, docId);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        docId,
        fileName,
        chunksIndexed: upsertedCount,
        message: `Successfully indexed ${upsertedCount} chunks from ${fileName}`,
      }),
    };
  } catch (err) {
    console.error("[ingest] Error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};