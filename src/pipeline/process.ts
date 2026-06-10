import { readJson, writeJson } from '../data/store';
import { createClient } from '../llm';
import { extractEntries } from './extractor';
import { verifyEntries } from './verifier';
import { config } from '../config';
import {
  Taxonomy, Source, SourcesFile, EntriesFile, Entry,
} from '../types';

function generateId(prefix: string, existingIds: string[]): string {
  const existing = new Set(existingIds);
  let i = 1;
  while (true) {
    const id = `${prefix}_${String(i).padStart(3, '0')}`;
    if (!existing.has(id)) return id;
    i++;
  }
}

export interface ProcessOptions {
  apiKeyOverride?: string;
  extractorModel?: string;
  verifierModel?: string;
  conservatism?: number;
  dryRun?: boolean;
}

export interface ProcessResult {
  source: Source | null;
  entries: Entry[];
  skippedDuplicates: number;
}

export async function processSource(
  rawText: string,
  title: string,
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const {
    apiKeyOverride,
    extractorModel,
    verifierModel,
    conservatism = config.defaults.conservatism,
    dryRun = false,
  } = options;

  const extractorClient = createClient('extractor', { apiKey: apiKeyOverride, model: extractorModel });
  const verifierClient  = createClient('verifier',  { apiKey: apiKeyOverride, model: verifierModel  });

  const taxonomy     = readJson<Taxonomy>('taxonomy.json');
  const sourcesFile  = readJson<SourcesFile>('sources.json');
  const entriesFile  = readJson<EntriesFile>('entries.json');

  console.log(`\n[Extractor] Processing "${title}" (${rawText.length} chars)...`);
  const proposed = await extractEntries(extractorClient, rawText, taxonomy, entriesFile.entries);
  console.log(`[Extractor] Proposed ${proposed.length} entries`);

  const existingSummaries = entriesFile.entries.map(e => ({ id: e.id, core_idea: e.core_idea }));

  console.log(`[Verifier] Verifying (conservatism: ${conservatism})...`);
  const verified = await verifyEntries(verifierClient, proposed, taxonomy, existingSummaries, conservatism);

  const unique       = verified.filter(e => !e.is_duplicate);
  const duplicateCount = verified.length - unique.length;
  console.log(`[Verifier] ${unique.length} unique, ${duplicateCount} duplicate(s) skipped\n`);

  if (dryRun) {
    console.log('[Dry run] Would add:');
    unique.forEach(e => console.log(`  · ${e.core_idea}`));
    return { source: null, entries: [], skippedDuplicates: duplicateCount };
  }

  const allSourceIds = sourcesFile.sources.map(s => s.id);
  const sourceId     = generateId('source', allSourceIds);

  const allEntryIds  = entriesFile.entries.map(e => e.id);
  const newEntries: Entry[] = unique.map(e => {
    const entryId = generateId('entry', allEntryIds);
    allEntryIds.push(entryId);
    return {
      id: entryId,
      source_id: sourceId,
      primary_theme: e.primary_theme,
      secondary_themes: e.secondary_themes,
      tags: e.tags,
      core_idea: e.core_idea,
      expanded_summary: e.expanded_summary,
      source_excerpt: e.source_excerpt,
      source_start_char: e.source_start_char,
      source_end_char: e.source_end_char,
      confidence: e.confidence,
      related_entry_ids: [],
    };
  });

  const source: Source = {
    id: sourceId,
    type: 'source',
    source_type: 'manual_diary_text',
    created_at: new Date().toISOString().split('T')[0],
    title,
    summary: `Processed ${new Date().toISOString().split('T')[0]}. ${newEntries.length} entries extracted.`,
    raw_text: rawText,
    child_entry_ids: newEntries.map(e => e.id),
  };

  sourcesFile.sources.push(source);
  entriesFile.entries.push(...newEntries);

  writeJson('sources.json', sourcesFile);
  writeJson('entries.json', entriesFile);

  return { source, entries: newEntries, skippedDuplicates: duplicateCount };
}
