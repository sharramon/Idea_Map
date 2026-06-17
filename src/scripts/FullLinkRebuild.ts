import { readJson, writeJson } from '../data/store';
import { rebuildLinks } from '../pipeline/links';
import { EntriesFile, LinksFile } from '../types';

function main(): void {
  const entriesFile = readJson<EntriesFile>('entries.json');
  const linksFile = readJson<LinksFile>('links.json');

  const beforeLinks = linksFile.links?.length ?? 0;
  const beforeEntries = entriesFile.entries.length;

  const rebuilt = rebuildLinks(entriesFile.entries);

  entriesFile.entries = rebuilt.entriesWithRelatedIds;
  linksFile.links = rebuilt.links;

  writeJson('entries.json', entriesFile);
  writeJson('links.json', linksFile);

  console.log(
    `[FullLinkRebuild] entries: ${beforeEntries} | links: ${beforeLinks} -> ${rebuilt.links.length}`,
  );
}

main();

