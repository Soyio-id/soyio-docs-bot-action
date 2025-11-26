import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryPinecone } from '../pinecone-query';

const pineconeMocks = vi.hoisted(() => {
  const mockEmbedContent = vi.fn();
  const mockQuery = vi.fn();
  const mockIndex = vi.fn(() => ({ query: mockQuery }));
  const GoogleGenAIMock = vi.fn(function () {
    return {
      models: {
        embedContent: mockEmbedContent
      }
    };
  });
  const PineconeMock = vi.fn(function () {
    return {
      index: mockIndex
    };
  });

  return {
    mockEmbedContent,
    mockQuery,
    mockIndex,
    GoogleGenAIMock,
    PineconeMock
  };
});

vi.mock('@google/genai', () => ({
  GoogleGenAI: pineconeMocks.GoogleGenAIMock
}));

vi.mock('@pinecone-database/pinecone', () => ({
  Pinecone: pineconeMocks.PineconeMock
}));

const mockEmbedContent = pineconeMocks.mockEmbedContent;
const mockQuery = pineconeMocks.mockQuery;
const mockIndex = pineconeMocks.mockIndex;
const MockGenAI = pineconeMocks.GoogleGenAIMock;
const MockPinecone = pineconeMocks.PineconeMock;

beforeEach(() => {
  mockEmbedContent.mockReset();
  mockQuery.mockReset();
  mockIndex.mockClear();
  MockGenAI.mockClear();
  MockPinecone.mockClear();
});

describe('queryPinecone', () => {
  it('returns formatted matches from Pinecone', async () => {
    mockEmbedContent.mockResolvedValue({
      embeddings: [{ values: [0.1, 0.2, 0.3] }]
    });
    mockQuery.mockResolvedValue({
      matches: [
        {
          metadata: {
            file: 'docs/guide.md',
            chunkIndex: 1,
            startLine: 5,
            endLine: 15,
            text: 'Snippet'
          },
          score: 0.87
        }
      ]
    });

    const results = await queryPinecone(
      'pinecone-key',
      'docs-index',
      'gemini-key',
      'search text',
      3
    );

    expect(results).toEqual([
      {
        file: 'docs/guide.md',
        chunkIndex: 1,
        startLine: 5,
        endLine: 15,
        text: 'Snippet',
        score: 0.87
      }
    ]);

    expect(mockEmbedContent).toHaveBeenCalledWith({
      model: 'models/text-embedding-004',
      contents: [{ parts: [{ text: 'search text' }] }]
    });
    expect(mockQuery).toHaveBeenCalledWith({
      vector: [0.1, 0.2, 0.3],
      topK: 3,
      includeMetadata: true
    });
    expect(MockPinecone).toHaveBeenCalledWith({ apiKey: 'pinecone-key' });
    expect(mockIndex).toHaveBeenCalledWith('docs-index');
  });
});
