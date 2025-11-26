import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSuggestions } from '../llm-suggester';
import type { QueryResult } from '../pinecone-query';

const genAiMocks = vi.hoisted(() => {
  const mockGenerateContent = vi.fn();
  const GoogleGenAIMock = vi.fn(function () {
    return {
      models: {
        generateContent: mockGenerateContent
      }
    };
  });
  return { mockGenerateContent, GoogleGenAIMock };
});

vi.mock('@google/genai', () => ({
  GoogleGenAI: genAiMocks.GoogleGenAIMock
}));

const mockGenerateContent = genAiMocks.mockGenerateContent;
const GoogleGenAIMock = genAiMocks.GoogleGenAIMock;

beforeEach(() => {
  mockGenerateContent.mockReset();
  GoogleGenAIMock.mockClear();
});

describe('generateSuggestions', () => {
  it('parses and sanitizes LLM output while attaching line numbers', async () => {
    const rawJson = `
{
  "impact_level": "low",
  "summary": "Update intro",
  "suggestions": [
    {
      "target_file": "docs/guide.md",
      "target_section": "Intro",
      "type": "update",
      "rationale": "Keep docs in sync",
      "suggested_text": "First line
Second line",
      "severity": "info"
    }
  ]
}
`.trim();

    mockGenerateContent.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [{ text: `\`\`\`json\n${rawJson}\n\`\`\`` }]
          }
        }
      ]
    });

    const docsContext: QueryResult[] = [
      {
        file: 'docs/guide.md',
        chunkIndex: 0,
        startLine: 10,
        endLine: 20,
        text: 'Guide section',
        score: 0.9
      }
    ];

    const result = await generateSuggestions(
      'gemini-api-key',
      'models/unit-test',
      'Add guide updates',
      'PR body',
      'diff content',
      docsContext
    );

    expect(result.impact_level).toBe('low');
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].target_file).toBe('docs/guide.md');
    expect(result.suggestions[0].suggested_text).toBe('First line\nSecond line');
    expect(result.suggestions[0].start_line).toBe(10);
    expect(result.suggestions[0].end_line).toBe(20);
    expect(mockGenerateContent).toHaveBeenCalledOnce();
    expect(mockGenerateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: 'models/unit-test',
      config: expect.objectContaining({
        responseMimeType: 'application/json'
      })
    }));
  });
});
