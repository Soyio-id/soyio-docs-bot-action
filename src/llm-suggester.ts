import { GoogleGenAI } from '@google/genai';
import { QueryResult } from './pinecone-query';
const SYSTEM_PROMPT = `You are a documentation assistant analyzing code changes.
Your job is to suggest documentation updates based on PR diffs and relevant documentation context.

**IMPORTANT**: Output ONLY valid JSON without any markdown fences and ensure all double quotes inside string values are escaped (e.g., \" inside suggested_text).

Output format:
{
  "impact_level": "none" | "low" | "medium" | "high",
  "summary": "Brief summary of suggested changes",
  "comment_intro": "1-sentence intro to use in the PR comment (match the requested tone/audience)",
  "suggestions": [
    {
      "target_file": "path/to/doc.md",
      "target_section": "Section name",
      "type": "update" | "add" | "remove",
      "rationale": "Why this change is needed",
      "suggested_text": "Proposed documentation text",
      "severity": "info" | "warning" | "critical"
    }
  ]
}

Rules:
- Only suggest changes if the PR actually affects documentation
- Be specific about file paths and line numbers
- Keep suggestions concise and actionable
- Provide comment_intro as a single friendly sentence that matches the requested tone/audience
- If a custom prompt_instruction is provided, apply it ONLY to comment_intro tone/voice. For suggested_text, match the tone/style of the supplied documentation context/examples and keep it clear for readers.
- If no changes needed, return impact_level: "none" and empty suggestions array`;

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  propertyOrdering: ['impact_level', 'summary', 'comment_intro', 'suggestions'],
  properties: {
    impact_level: {
      type: 'string',
      enum: ['none', 'low', 'medium', 'high']
    },
    summary: { type: 'string' },
    comment_intro: { type: 'string' },
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        propertyOrdering: [
          'target_file',
          'target_section',
          'type',
          'rationale',
          'suggested_text',
          'severity'
        ],
        properties: {
          target_file: { type: 'string' },
          target_section: { type: 'string' },
          type: { type: 'string', enum: ['update', 'add', 'remove'] },
          rationale: { type: 'string' },
          suggested_text: { type: 'string' },
          severity: { type: 'string', enum: ['info', 'warning', 'critical'] }
        },
        required: [
          'target_file',
          'target_section',
          'type',
          'rationale',
          'suggested_text',
          'severity'
        ]
      }
    }
  },
  required: ['impact_level', 'summary', 'suggestions']
};

export interface Suggestion {
  target_file: string;
  target_section: string;
  type: 'update' | 'add' | 'remove';
  rationale: string;
  suggested_text: string;
  severity: 'info' | 'warning' | 'critical';
  start_line?: number;
  end_line?: number;
}

export interface LLMResponse {
  impact_level: 'none' | 'low' | 'medium' | 'high';
  summary: string;
  comment_intro?: string;
  suggestions: Suggestion[];
}

/**
 * Generate documentation suggestions using Gemini
 */
export async function generateSuggestions(
  apiKey: string,
  model: string,
  prTitle: string,
  prBody: string,
  diff: string,
  docsContext: QueryResult[],
  promptInstruction = '',
  commentIntro = ''
): Promise<LLMResponse> {
  const genai = new GoogleGenAI({ apiKey });

  const customInstruction = promptInstruction.trim().slice(0, 2000);
  const introLine = commentIntro.trim();
  const introGuidance = introLine
    ? `\n\nPlanned PR comment intro (match this tone/voice):\n${introLine}`
    : '';

  const toneGuidance = customInstruction
    ? `\n\nTone guidance (for comment_intro only; suggested_text should follow the tone/style of the provided documentation context, not this guidance):\n${customInstruction}`
    : '';

  const systemPrompt = `${SYSTEM_PROMPT}${toneGuidance}${introGuidance}`;

  // Build prompt
  const contextText = docsContext.length === 0
    ? 'No relevant documentation found.'
    : docsContext.map((doc, i) =>
        `[${i + 1}] ${doc.file} (lines ${doc.startLine}-${doc.endLine}) - score: ${doc.score.toFixed(3)}\n${doc.text}`
      ).join('\n\n');

  const userPrompt = `
PR Title: ${prTitle}
PR Description: ${prBody || '(empty)'}

Diff (truncated to 10000 chars):
${diff.substring(0, 10000)}

Relevant Documentation Context:
${contextText}

Based on this PR, suggest documentation updates.
`.trim();

  // Call Gemini
  const result = await genai.models.generateContent({
    model,
    contents: [{
      role: 'user',
      parts: [{ text: `${systemPrompt}\n\n---\n\n${userPrompt}` }]
    }],
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: RESPONSE_SCHEMA
    }
  });

  const candidate = result.candidates?.[0];
  if (!candidate) {
    throw new Error('No response from Gemini');
  }

  // ----- Extract raw text -----
  const rawText = candidate.content?.parts?.map(p => p.text).join('\n').trim() || '';

  // Log raw response (useful for debugging)
  console.log('\n--- RAW LLM RESPONSE ---');
  console.log(rawText);
  console.log('--- END RAW RESPONSE ---\n');

  // ----- Strip outer markdown fences -----
  const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonString = jsonMatch ? jsonMatch[1] : rawText;

  // ----- Sanitize: remove stray triple backticks inside strings -----
  // Keep the JSON structure intact; just strip stray fences/whitespace and escape raw newlines inside string literals
  const sanitized = escapeNewlinesInStrings(jsonString.replace(/```/g, '').trim());

  // ----- Parse JSON with fallback extraction -----
  let parsed: LLMResponse;
  try {
    parsed = JSON.parse(sanitized.trim());
  } catch (e) {
    console.error('Failed to parse JSON directly:', e);
    // Try to locate the first { and last } as a last resort
    const startIdx = sanitized.indexOf('{');
    const endIdx = sanitized.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1) {
      const extracted = sanitized.slice(startIdx, endIdx + 1);
      try {
        parsed = JSON.parse(extracted);
      } catch (inner) {
        console.warn('Fallback JSON parse also failed. Returning empty response.', inner);
        return {
          impact_level: 'none',
          summary: 'Unable to generate suggestions due to parsing error.',
          suggestions: []
        };
      }
    } else {
      console.warn('No JSON braces found. Returning empty response.');
      return {
        impact_level: 'none',
        summary: 'Unable to generate suggestions - no valid response.',
        suggestions: []
      };
    }
  }

  // ----- Enrich suggestions with line numbers from context -----
  parsed.suggestions = parsed.suggestions.map(s => {
    const matchingDoc = docsContext.find(d => d.file === s.target_file);
    return {
      ...s,
      start_line: matchingDoc?.startLine,
      end_line: matchingDoc?.endLine
    };
  });

  return parsed;
}

// Escape raw newlines that appear inside JSON string literals so we can handle
// slightly malformed LLM outputs without breaking JSON.parse.
function escapeNewlinesInStrings(input: string): string {
  let inString = false;
  let escaped = false;
  let out = '';

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (!inString) {
      if (ch === '"') {
        inString = true;
      }
      out += ch;
      continue;
    }

    // Inside a string literal
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      out += ch;
      inString = false;
      continue;
    }

    if (ch === '\n') {
      out += '\\n';
      continue;
    }

    if (ch === '\r') {
      // Drop CR to avoid control characters inside strings
      continue;
    }

    out += ch;
  }

  return out;
}
