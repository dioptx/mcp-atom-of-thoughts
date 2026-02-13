import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

let _d3Cache: string | null = null;

export function getD3Script(): string {
  if (_d3Cache !== null) return _d3Cache;

  const thisDir = path.dirname(fileURLToPath(import.meta.url));

  const candidates = [
    path.join(thisDir, '..', 'assets', 'd3.v7.min.js'),
    path.join(thisDir, 'd3.v7.min.js'),
    path.join(process.cwd(), 'assets', 'd3.v7.min.js'),
    path.join(process.cwd(), 'build', 'd3.v7.min.js'),
  ];

  for (const candidate of candidates) {
    try {
      _d3Cache = fs.readFileSync(candidate, 'utf-8');
      return _d3Cache;
    } catch {
      continue;
    }
  }

  _d3Cache = '';
  return _d3Cache;
}
