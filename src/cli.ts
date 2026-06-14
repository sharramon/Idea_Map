import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { processSource, DuplicateSourceError } from './pipeline/process';
import { generateGraph, publishSite, githubPagesUrl, openInBrowser } from './renderer/generate';
import { config, validateConfig } from './config';

const program = new Command();

program
  .name('idea-map')
  .description('Personal Idea Mapping Tool — diary text → interactive graph')
  .version('1.0.0');

// ─── process ────────────────────────────────────────────────────────────────
program
  .command('process')
  .description('Process a text file through the two-pass LLM pipeline')
  .requiredOption('-f, --file <path>', 'Path to the diary/text file')
  .requiredOption('-t, --title <title>', 'Title for this source entry')
  .option('-c, --conservatism <number>', 'Verifier conservatism 0.0–1.0', parseFloat, config.defaults.conservatism)
  .option('--extractor-model <model>', 'Extractor model', config.models.extractor)
  .option('--verifier-model <model>', 'Verifier model', config.models.verifier)
  .option('--dry-run', 'Preview extractions without writing to disk', false)
  .option('--reprocess', 'Delete previous analysis of this text and re-run', false)
  .option('-k, --api-key <key>', 'Anthropic API key (overrides config)')
  .action(async opts => {
    const apiKeyOverride: string | undefined = opts.apiKey || undefined;

    try {
      validateConfig();
    } catch {
      process.exit(1);
    }

    const filePath = path.resolve(opts.file);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }

    const rawText = fs.readFileSync(filePath, 'utf-8');
    if (!rawText.trim()) {
      console.error('Error: File is empty.');
      process.exit(1);
    }

    try {
      const result = await processSource(rawText, opts.title, {
        apiKeyOverride,
        extractorModel: opts.extractorModel,
        verifierModel: opts.verifierModel,
        conservatism: opts.conservatism,
        dryRun: opts.dryRun,
        reprocess: opts.reprocess,
      });

      if (!opts.dryRun && result.source) {
        console.log(`Done! Added ${result.entries.length} entries from "${opts.title}"`);
        if (result.skippedDuplicates > 0) {
          console.log(`Skipped ${result.skippedDuplicates} duplicate(s)`);
        }
        console.log('\nRun `npm run view` to see your updated map.');
      }
    } catch (err) {
      if (err instanceof DuplicateSourceError) {
        console.error(`Already processed: ${err.message}`);
        console.error('Use --reprocess to delete the previous analysis and run again.');
        process.exit(1);
      }
      console.error('Processing failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ─── view ────────────────────────────────────────────────────────────────────
program
  .command('view')
  .description('Generate the graph HTML and open it in your browser')
  .option('--theme <themeId>', 'Filter to a specific theme id')
  .option('--no-open', 'Generate HTML without opening the browser')
  .action(opts => {
    try {
      const outPath = generateGraph(opts.theme);
      console.log(`Graph written to: ${outPath}`);
      if (opts.open !== false) {
        openInBrowser(outPath);
      }
    } catch (err) {
      console.error('View failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ─── deploy ──────────────────────────────────────────────────────────────────
program
  .command('deploy')
  .description('Build docs/index.html for GitHub Pages (phone-friendly URL after push)')
  .option('--theme <themeId>', 'Filter to a specific theme id')
  .option('--no-open', 'Generate site files without opening the browser')
  .action(opts => {
    try {
      const { distPath, sitePath } = publishSite(opts.theme);
      console.log(`Local graph:  ${distPath}`);
      console.log(`Site bundle:  ${sitePath}`);
      console.log(`\nAfter push + GitHub Pages deploy, open on your phone:`);
      console.log(`  ${githubPagesUrl()}`);
      console.log('\nPrivacy: the site embeds full diary text. Use a private GitHub repo.');
      console.log('Push to main, then enable Pages: Settings → Pages → Source: GitHub Actions.');
      if (opts.open !== false) {
        openInBrowser(sitePath);
      }
    } catch (err) {
      console.error('Deploy build failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ─── list ────────────────────────────────────────────────────────────────────
program
  .command('list')
  .description('List all entries in the terminal')
  .option('--theme <themeId>', 'Filter by theme id')
  .action(opts => {
    try {
      const { readJson } = require('./data/store');
      const { EntriesFile } = require('./types');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { entries } = readJson('entries.json') as { entries: Array<{ id: string; primary_theme: string; tags: string[] }> };
      const filtered = opts.theme
        ? entries.filter((e: { primary_theme: string }) => e.primary_theme === opts.theme)
        : entries;

      if (filtered.length === 0) {
        console.log('No entries yet. Process a diary file first.');
        return;
      }

      filtered.forEach((e: { id: string; primary_theme: string; tags: string[]; core_idea?: string }) => {
        const idea = e.core_idea ? `\n    ${e.core_idea}` : '';
        console.log(`[${e.id}] (${e.primary_theme}) ${e.tags.join(', ')}${idea}`);
      });
      console.log(`\n${filtered.length} entries total`);
    } catch (err) {
      console.error('List failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ─── add-anchor ──────────────────────────────────────────────────────────────
program
  .command('add-anchor')
  .description('Register a physical object as an AR anchor')
  .requiredOption('-n, --name <name>', 'Display name (e.g. "Jace, the Mind Sculptor")')
  .requiredOption('--type <type>', 'Object type: mtg_card | physical_object | image | qr_code')
  .requiredOption('--identifier <id>', 'Unique slug for this object (e.g. "jace-the-mind-sculptor")')
  .option('--themes <ids>', 'Comma-separated theme ids to link', '')
  .option('--tags <ids>', 'Comma-separated tag ids to link', '')
  .option('--entries <ids>', 'Comma-separated entry ids to link', '')
  .action(opts => {
    try {
      const { readJson, writeJson } = require('./data/store');
      const anchorsFile = readJson('anchors.json') as { anchors: unknown[] };

      const existingIds = (anchorsFile.anchors as Array<{ id: string }>).map(a => a.id);
      const existing = new Set(existingIds);
      let i = 1;
      let anchorId = `anchor_001`;
      while (existing.has(anchorId)) { i++; anchorId = `anchor_${String(i).padStart(3, '0')}`; }

      const anchor = {
        id: anchorId,
        name: opts.name,
        object_type: opts.type,
        identifier: opts.identifier,
        linked_theme_ids: opts.themes ? opts.themes.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
        linked_tag_ids: opts.tags ? opts.tags.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
        linked_entry_ids: opts.entries ? opts.entries.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      };

      anchorsFile.anchors.push(anchor);
      writeJson('anchors.json', anchorsFile);
      console.log(`Added anchor: ${anchor.id} → "${anchor.name}"`);
    } catch (err) {
      console.error('add-anchor failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch(err => {
  console.error(err);
  process.exit(1);
});
