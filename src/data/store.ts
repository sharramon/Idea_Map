import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(__dirname, '../../data');
const RAW_DIR = path.join(DATA_DIR, 'raw');

export function readJson<T>(filename: string): T {
  const filepath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filepath)) {
    throw new Error(`Data file not found: ${filepath}\nRun from the project root.`);
  }
  const raw = fs.readFileSync(filepath, 'utf-8').replace(/^\uFEFF/, '');
  return JSON.parse(raw) as T;
}

export function writeJson<T>(filename: string, data: T): void {
  const filepath = path.join(DATA_DIR, filename);
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
}

export function writeRawText(sourceId: string, text: string): string {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const filename = `${sourceId}.txt`;
  fs.writeFileSync(path.join(RAW_DIR, filename), text, 'utf-8');
  return `data/raw/${filename}`;
}

export function readRawText(rawTextPath: string): string {
  const filepath = path.join(DATA_DIR, '..', rawTextPath);
  return fs.readFileSync(filepath, 'utf-8');
}

export function deleteRawText(rawTextPath: string): void {
  const filepath = path.join(DATA_DIR, '..', rawTextPath);
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
}
