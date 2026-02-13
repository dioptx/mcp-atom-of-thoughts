import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { checkApproval } from '../src/approval.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('checkApproval', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aot-approval-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns PENDING when no files exist', () => {
    const result = checkApproval(tmpDir);
    expect(result.status).toBe('PENDING');
  });

  it('returns PENDING for non-existent directory', () => {
    const result = checkApproval('/tmp/nonexistent-aot-test-dir-12345');
    expect(result.status).toBe('PENDING');
  });

  it('parses APPROVED result when file exists', () => {
    const approval = {
      status: 'APPROVED',
      timestamp: new Date().toISOString(),
      approvedNodes: ['P1', 'R1'],
    };
    fs.writeFileSync(
      path.join(tmpDir, `aot-approval-${Date.now()}.json`),
      JSON.stringify(approval)
    );

    const result = checkApproval(tmpDir, Date.now() - 60000);
    expect(result.status).toBe('APPROVED');
  });

  it('parses NEEDS_REVISION result', () => {
    const approval = {
      status: 'NEEDS_REVISION',
      timestamp: new Date().toISOString(),
      rejections: [{ nodeId: 'H1', feedback: 'Too vague' }],
    };
    fs.writeFileSync(
      path.join(tmpDir, `aot-approval-${Date.now()}.json`),
      JSON.stringify(approval)
    );

    const result = checkApproval(tmpDir, Date.now() - 60000);
    expect(result.status).toBe('NEEDS_REVISION');
  });

  it('ignores files older than session start', () => {
    const oldTime = Date.now() - 1000;
    const approval = { status: 'APPROVED' };
    const filepath = path.join(tmpDir, `aot-approval-${oldTime}.json`);
    fs.writeFileSync(filepath, JSON.stringify(approval));

    // Set mtime to be old
    const veryOld = new Date(Date.now() - 700000);
    fs.utimesSync(filepath, veryOld, veryOld);

    const result = checkApproval(tmpDir, Date.now());
    expect(result.status).toBe('PENDING');
  });

  it('handles malformed JSON gracefully', () => {
    fs.writeFileSync(
      path.join(tmpDir, `aot-approval-${Date.now()}.json`),
      'not valid json {'
    );

    const result = checkApproval(tmpDir, Date.now() - 60000);
    expect(result.status).toBe('PENDING');
  });

  it('ignores non-matching filenames', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'other-file.json'),
      JSON.stringify({ status: 'APPROVED' })
    );

    const result = checkApproval(tmpDir, Date.now() - 60000);
    expect(result.status).toBe('PENDING');
  });
});
