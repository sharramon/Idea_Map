/** Extract the first balanced JSON array from an LLM response. */
export function extractJsonArray(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : text.trim();

  const start = raw.indexOf('[');
  if (start === -1) throw new Error('No JSON array found in LLM response');

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '[') depth++;
    if (c === ']') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }

  throw new Error('Unbalanced JSON array in LLM response');
}

export function parseLlmJsonArray(text: string): unknown[] {
  return JSON.parse(extractJsonArray(text)) as unknown[];
}
