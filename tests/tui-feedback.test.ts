import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { TuiState, defaultSettings } from '../src/tui-types.js';
import { buildApprovalPayload, postApproval, submitFeedback } from '../src/tui-feedback.js';
import { AtomData } from '../src/types.js';

function makeAtom(id: string, type: AtomData['atomType'], deps: string[] = []): AtomData {
  return {
    atomId: id,
    content: `content of ${id}`,
    atomType: type,
    dependencies: deps,
    confidence: 0.9,
    created: 0,
    isVerified: false,
  };
}

function makeState(feedbackDir: string): TuiState {
  return {
    atoms: {
      P1: makeAtom('P1', 'premise'),
      H1: makeAtom('H1', 'hypothesis', ['P1']),
      C1: makeAtom('C1', 'conclusion', ['H1']),
    },
    order: ['P1', 'H1', 'C1'],
    termination: null,
    mode: 'fast',
    maxDepth: 3,
    lastEventAt: null,
    decompositions: new Set(),
    feedback: {},
    selectedIdx: 0,
    uiMode: 'main',
    settingsIdx: 0,
    noteBuffer: '',
    paused: false,
    velocityBuckets: [],
    flash: null,
    settings: defaultSettings(feedbackDir),
  };
}

describe('tui-feedback: buildApprovalPayload', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aot-fb-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('marks status APPROVED when only acceptances', () => {
    const state = makeState(dir);
    state.feedback.P1 = { verdict: 'accepted', at: 1 };
    state.feedback.C1 = { verdict: 'accepted', at: 2 };
    const payload = buildApprovalPayload(state);
    expect(payload.status).toBe('APPROVED');
    expect(payload.approvedNodes).toEqual(['P1', 'C1']);
    expect(payload.rejections).toBeUndefined();
  });

  it('marks status NEEDS_REVISION when any rejection', () => {
    const state = makeState(dir);
    state.feedback.P1 = { verdict: 'accepted', at: 1 };
    state.feedback.H1 = { verdict: 'rejected', note: 'no good', at: 2 };
    const payload = buildApprovalPayload(state);
    expect(payload.status).toBe('NEEDS_REVISION');
    expect(payload.rejections).toHaveLength(1);
    expect(payload.rejections![0]).toEqual({ nodeId: 'H1', feedback: 'no good' });
  });

  it('attaches sessionId when present', () => {
    const state = makeState(dir);
    state.sessionId = 'default-2';
    state.feedback.P1 = { verdict: 'accepted', at: 1 };
    const payload = buildApprovalPayload(state) as { sessionId?: string };
    expect(payload.sessionId).toBe('default-2');
  });

  it('skips entries whose atom is missing', () => {
    const state = makeState(dir);
    state.feedback.GHOST = { verdict: 'accepted', at: 1 };
    state.feedback.P1 = { verdict: 'accepted', at: 2 };
    const payload = buildApprovalPayload(state);
    expect(payload.approvedNodes).toEqual(['P1']);
  });

  it('starred entries are not counted as accept or reject', () => {
    const state = makeState(dir);
    state.feedback.P1 = { verdict: 'starred', at: 1 };
    const payload = buildApprovalPayload(state);
    expect(payload.approvedNodes).toBeUndefined();
    expect(payload.rejections).toBeUndefined();
    expect(payload.status).toBe('APPROVED'); // no rejections
  });
});

describe('tui-feedback: postApproval', () => {
  let server: http.Server;
  let port: number;
  let received: unknown[] = [];

  beforeEach(async () => {
    received = [];
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try { received.push(JSON.parse(body)); } catch { received.push(body); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('POSTs the payload and resolves with the response', async () => {
    const payload = {
      status: 'APPROVED' as const,
      timestamp: 'now',
      title: 't',
      phases: { P1: 'APPROVED' },
      approvedNodes: ['P1'],
      sessionId: 'default',
    };
    const res = await postApproval(`http://127.0.0.1:${port}/approval`, payload);
    expect(res).toEqual({ ok: true });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ status: 'APPROVED', sessionId: 'default' });
  });

  it('rejects on a non-2xx response', async () => {
    const failServer = http.createServer((_req, res) => { res.writeHead(500); res.end(); });
    await new Promise<void>((resolve) => failServer.listen(0, '127.0.0.1', resolve));
    const addr = failServer.address();
    const failPort = typeof addr === 'object' && addr ? addr.port : 0;
    try {
      await expect(
        postApproval(`http://127.0.0.1:${failPort}/approval`, { status: 'APPROVED' })
      ).rejects.toThrow(/500/);
    } finally {
      await new Promise<void>((resolve) => failServer.close(() => resolve()));
    }
  });

  it('rejects on connection refused', async () => {
    // Port 1 is reserved; nothing listens.
    await expect(
      postApproval('http://127.0.0.1:1/approval', { status: 'APPROVED' }, 200)
    ).rejects.toBeDefined();
  });

  it('rejects on unsupported protocol', async () => {
    await expect(
      postApproval('ftp://example.com/approval', { status: 'APPROVED' })
    ).rejects.toThrow(/protocol/);
  });
});

describe('tui-feedback: submitFeedback http vs file fallback', () => {
  let dir: string;
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aot-submit-'));
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, body: JSON.parse(body) }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('uses HTTP path when callbackUrl is set and the server responds', async () => {
    const state = makeState(dir);
    state.callbackUrl = `http://127.0.0.1:${port}/approval`;
    state.feedback.P1 = { verdict: 'accepted', at: 1 };
    const result = await submitFeedback(state);
    expect(result.source).toBe('http');
    expect(result.status).toBe('APPROVED');
    expect(result.url).toBe(state.callbackUrl);
    // No file should have been written.
    const files = fs.readdirSync(dir).filter(f => f.startsWith('aot-approval-'));
    expect(files).toHaveLength(0);
  });

  it('falls back to file when callbackUrl is unreachable', async () => {
    const state = makeState(dir);
    state.callbackUrl = 'http://127.0.0.1:1/approval';
    state.feedback.P1 = { verdict: 'accepted', at: 1 };
    const result = await submitFeedback(state);
    expect(result.source).toBe('file');
    expect(result.filepath).toBeDefined();
    expect(fs.existsSync(result.filepath!)).toBe(true);
  });

  it('writes a file directly when no callbackUrl is set', async () => {
    const state = makeState(dir);
    state.feedback.H1 = { verdict: 'rejected', note: 'wrong', at: 1 };
    const result = await submitFeedback(state);
    expect(result.source).toBe('file');
    expect(result.status).toBe('NEEDS_REVISION');
    const written = JSON.parse(fs.readFileSync(result.filepath!, 'utf-8'));
    expect(written.status).toBe('NEEDS_REVISION');
    expect(written.rejections[0]).toEqual({ nodeId: 'H1', feedback: 'wrong' });
  });
});
