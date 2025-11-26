import { Pinecone } from '@pinecone-database/pinecone';
import { GoogleGenAI } from '@google/genai';

export interface QueryResult {
  file: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  text: string;
  score: number;
}

/**
 * Query Pinecone for relevant documentation chunks
 */
export async function queryPinecone(
  apiKey: string,
  indexName: string,
  geminiApiKey: string,
  query: string,
  topK: number = 5
): Promise<QueryResult[]> {
  // Generate query embedding
  const genai = new GoogleGenAI({ apiKey: geminiApiKey });

  const result = await genai.models.embedContent({
    model: 'models/text-embedding-004',
    contents: [{ parts: [{ text: query }] }]
  });

  if (!result.embeddings || !result.embeddings[0]) {
    throw new Error('Failed to generate query embedding');
  }

  const queryEmbedding = result.embeddings[0].values!;

  // Query Pinecone
  const pinecone = new Pinecone({ apiKey });
  const index = pinecone.index(indexName);

  const queryResponse = await index.query({
    vector: queryEmbedding,
    topK,
    includeMetadata: true
  });

  // Format results
  type MatchMetadata = Partial<Pick<QueryResult, 'file' | 'chunkIndex' | 'startLine' | 'endLine' | 'text'>>;
  const matches = (queryResponse.matches ?? []) as Array<{ metadata?: MatchMetadata; score?: number }>;

  const results: QueryResult[] = matches.map(match => ({
    file: match.metadata?.file || 'unknown',
    chunkIndex: match.metadata?.chunkIndex || 0,
    startLine: match.metadata?.startLine || 0,
    endLine: match.metadata?.endLine || 0,
    text: match.metadata?.text || '',
    score: match.score || 0
  }));

  return results;
}
