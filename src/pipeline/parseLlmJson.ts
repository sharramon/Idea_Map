function snippet(s: string): string {
  if (s.length <= 500) return s;
  return s.slice(0, 250) + '\n…[truncated]…\n' + s.slice(-250);
}

/** Extract the first balanced JSON array from an LLM response. */
export function extractJsonArray(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : text.trim();

  const start = raw.indexOf('[');
  if (start === -1) {
    throw new Error(`No JSON array found in LLM response.\nRaw response:\n${snippet(raw)}`);
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '[') depth++;
    if (c === ']') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }

  throw new Error(`Unbalanced JSON array (likely truncated by token limit).\nRaw response:\n${snippet(raw)}`);
}

export function parseLlmJsonArray(text: string): unknown[] {
  const extracted = extractJsonArray(text);
  try {
    return JSON.parse(extracted) as unknown[];
  } catch (err) {
    throw new Error(`JSON.parse failed: ${err instanceof Error ? err.message : err}\nExtracted JSON:\n${snippet(extracted)}`);
  }
}
