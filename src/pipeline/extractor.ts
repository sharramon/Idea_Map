import { LLMClient } from '../llm/client';
import { Taxonomy, Entry } from '../types';

const SYSTEM_PROMPT = `You are a creative idea extractor. Analyze diary/journal text and extract every distinct, meaningful idea as a structured entry.

Rules:
- Each entry = ONE specific thought or insight. Be thorough; it's better to propose more than to miss ideas.
- Do not duplicate ideas that already exist in the existing entries list.
- Map each idea to a theme and tags from the provided taxonomy. Use EXACT ids from the taxonomy.
- Estimate character positions (source_start_char, source_end_char) of the excerpt in the source text.
- Confidence scores: 0.0–1.0 for how sure you are about theme/tag assignments.

Return ONLY a valid JSON array. No markdown, no explanation.

Schema for each element:
{
  "core_idea": string,           // one crisp sentence
  "expanded_summary": string,    // 2-3 sentences of context
  "primary_theme": string,       // theme id from taxonomy
  "secondary_themes": string[],  // other relevant theme ids
  "tags": string[],              // tag ids from taxonomy
  "source_excerpt": string,      // short verbatim quote from source
  "source_start_char": number,
  "source_end_char": number,
  "confidence": {
    "primary_theme": number,
    "tags": { [tag_id]: number }
  }
}`;

export interface ExtractorOutput {
  core_idea: string;
  expanded_summary: string;
  primary_theme: string;
  secondary_themes: string[];
  tags: string[];
  source_excerpt: string;
  source_start_char: number;
  source_end_char: number;
  confidence: {
    primary_theme: number;
    tags: Record<string, number>;
  };
}

function parseJsonArray(text: string): unknown[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : text.trim();
  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (!arrayMatch) throw new Error('No JSON array found in extractor response');
  return JSON.parse(arrayMatch[0]) as unknown[];
}

export async function extractEntries(
  client: LLMClient,
  sourceText: string,
  taxonomy: Taxonomy,
  existingEntries: Entry[],
): Promise<ExtractorOutput[]> {
  const existingSummary = existingEntries.length > 0
    ? JSON.stringify(existingEntries.map(e => ({ id: e.id, core_idea: e.core_idea })), null, 2)
    : 'None yet.';

  const userMessage = `## Taxonomy\n${JSON.stringify(taxonomy, null, 2)}\n\n## Existing Entries (do not duplicate)\n${existingSummary}\n\n## Source Text\n${sourceText}`;

  const text = await client.complete(SYSTEM_PROMPT, userMessage, 4096);
  return parseJsonArray(text) as ExtractorOutput[];
}
