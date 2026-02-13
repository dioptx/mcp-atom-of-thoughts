import * as fs from 'node:fs';
import * as path from 'node:path';
import { ApprovalResult } from './types.js';

export function checkApproval(
  downloadsDir?: string,
  sessionStartTime?: number
): ApprovalResult | { status: 'PENDING' } {
  const dir = downloadsDir || process.env.AOT_DOWNLOADS_DIR || path.join(process.env.HOME || '~', 'Downloads');
  const startTime = sessionStartTime || Date.now() - 600_000; // default: last 10 minutes

  let files: string[];
  try {
    files = fs.readdirSync(dir)
      .filter(f => f.startsWith('aot-approval-') && f.endsWith('.json'));
  } catch {
    return { status: 'PENDING' };
  }

  if (files.length === 0) {
    return { status: 'PENDING' };
  }

  // Sort by timestamp in filename (newest first)
  files.sort().reverse();

  for (const file of files) {
    const filepath = path.join(dir, file);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filepath);
    } catch {
      continue;
    }

    // Skip files older than session start
    if (stat.mtimeMs < startTime) {
      continue;
    }

    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      const result = JSON.parse(content) as ApprovalResult;

      if (result.status === 'APPROVED' || result.status === 'NEEDS_REVISION') {
        return result;
      }
    } catch {
      // Malformed JSON, skip
      continue;
    }
  }

  return { status: 'PENDING' };
}
