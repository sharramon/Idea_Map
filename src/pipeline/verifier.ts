import Anthropic from '@anthropic-ai/sdk';
import { Taxonomy } from '../types';
import { ExtractorOutput } from './extractor';

const SYSTEM_PROMPT_TEMPLATE = `You are a conservative taxonomy verifier. Normalize extracted entries against the existing taxonomy.

Tasks for each entry:
1. Validate primary_theme — must be a valid theme id. If wrong, pick the best match.
2. Normalize tags — map to existing tag ids where possible. Conservatism level controls when to create new ones.
3. Detect duplicates — set is_duplicate: true and duplicate_of: <entry_id> if this matches an existing entry.
4. Adjust confidence scores based on your assessment.

Conservatism level: CONSERVATISM_LEVEL (0.0 to 1.0)
- 0.0 = freely propose new tags/themes when needed
- 0.5 = create new tags only when clearly justified
- 1.0 = almost never create new tags; always map to existing ones

Return ONLY a valid JSON array. No markdown, no explanation.

Same schema as input, plus two fields on each object:
  "is_duplicate": boolean,
  "duplicate_of": string | null   // existing entry id if duplicate`;

export interface VerifierOutput extends ExtractorOutput {
  is_duplicate: boolean;
  duplicate_of: string | null;
}

function parseJsonArray(text: string): unknown[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : text.trim();
  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (!arrayMatch) throw new Error('No JSON array found in verifier response');
  return JSON.parse(arrayMatch[0]) as unknown[];
}

export async function verifyEntries(
  client: Anthropic,
  proposed: ExtractorOutput[],
  taxonomy: Taxonomy,
  existingEntrySummaries: Array<{ id: string; core_idea: string }>,
  conservatism: number,
  model: string,
): Promise<VerifierOutput[]> {
  const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace(
    'CONSERVATISM_LEVEL',
    conservatism.toFixed(1),
  );

  const userMessage = [
    '## Current Taxonomy',
    JSON.stringify(taxonomy, null, 2),
    '',
    '## Existing Entries (for duplicate detection)',
    existingEntrySummaries.length > 0
      ? JSON.stringify(existingEntrySummaries, null, 2)
      : 'None yet.',
    '',
    '## Proposed Entries to Verify',
    JSON.stringify(proposed, null, 2),
  ].join('\n');

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected non-text response from verifier');

  return parseJsonArray(block.text) as VerifierOutput[];
}
