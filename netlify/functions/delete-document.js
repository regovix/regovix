// netlify/functions/delete-document.js
const { Pinecone } = require("@pinecone-database/pinecone");

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST" && event.httpMethod !== "DELETE") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { docId, userId, deleteAll } = JSON.parse(event.body || "{}");

    if (!userId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing userId" }) };
    }

    const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const index = pc.index(process.env.PINECONE_INDEX || "twin-knowledge");
    const namespace = index.namespace(userId);

    if (deleteAll) {
      await namespace.deleteAll();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: "All documents deleted" }),
      };
    }

    if (!docId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing docId" }) };
    }

    const chunkIds = [];
    for (let i = 0; i < 500; i++) {
      chunkIds.push(`${docId}_chunk_${i}`);
    }
    await namespace.deleteMany(chunkIds);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, docId, message: `Deleted chunks for ${docId}` }),
    };
  } catch (err) {
    console.error("[delete-doc] Error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};