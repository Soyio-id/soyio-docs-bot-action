"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryPinecone = queryPinecone;
const pinecone_1 = require("@pinecone-database/pinecone");
const genai_1 = require("@google/genai");
/**
 * Query Pinecone for relevant documentation chunks
 */
async function queryPinecone(apiKey, indexName, geminiApiKey, query, topK = 5) {
    // Generate query embedding
    const genai = new genai_1.GoogleGenAI({ apiKey: geminiApiKey });
    const result = await genai.models.embedContent({
        model: 'models/text-embedding-004',
        contents: [{ parts: [{ text: query }] }]
    });
    if (!result.embeddings || !result.embeddings[0]) {
        throw new Error('Failed to generate query embedding');
    }
    const queryEmbedding = result.embeddings[0].values;
    // Query Pinecone
    const pinecone = new pinecone_1.Pinecone({ apiKey });
    const index = pinecone.index(indexName);
    const queryResponse = await index.query({
        vector: queryEmbedding,
        topK,
        includeMetadata: true
    });
    const matches = (queryResponse.matches ?? []);
    const results = matches.map(match => ({
        file: match.metadata?.file || 'unknown',
        chunkIndex: match.metadata?.chunkIndex || 0,
        startLine: match.metadata?.startLine || 0,
        endLine: match.metadata?.endLine || 0,
        text: match.metadata?.text || '',
        score: match.score || 0
    }));
    return results;
}
