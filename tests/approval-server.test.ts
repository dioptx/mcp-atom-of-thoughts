import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import { ApprovalCallbackServer, ApprovalRecord } from '../src/approval-server.js';

function postJson(url: string, body: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = http.request(
      {
        method: 'POST',
        hostname: u.hostname,
        port: Number(u.port),
        path: u.pathname,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        let chunks = '';
        res.on('data', (c) => { chunks += c; });
        res.on('end', () => resolve({ status: res.statusCode || 0, body: chunks }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJson(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => resolve({ status: res.statusCode || 0, body: chunks }));
    }).on('error', reject);
  });
}

describe('ApprovalCallbackServer', () => {
  let server: ApprovalCallbackServer;
  let url: string;

  beforeEach(async () => {
    server = new ApprovalCallbackServer();
    const info = await server.start();
    expect(info).not.toBeNull();
    url = info!.url;
  });

  afterEach(async () => {
    await server.stop();
  });

  it('binds to 127.0.0.1 and an ephemeral port', () => {
    expect(server.getPort()).toBeGreaterThan(0);
    expect(server.getCallbackUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/approval$/);
  });

  it('returns 200 on a valid POST and stores the record', async () => {
    const res = await postJson(url, {
      sessionId: 'session-1',
      status: 'APPROVED',
      title: 'Test plan',
      approvedNodes: ['P1', 'R1'],
    });
    expect(res.status).toBe(200);
    const stored = server.getApprovals('session-1');
    expect(stored).toHaveLength(1);
    expect(stored[0].status).toBe('APPROVED');
    expect(stored[0].sessionId).toBe('session-1');
    expect(stored[0].approvedNodes).toEqual(['P1', 'R1']);
  });

  it('defaults sessionId to "default" when omitted', async () => {
    await postJson(url, { status: 'APPROVED' });
    const stored = server.getApprovals('default');
    expect(stored).toHaveLength(1);
  });

  it('keeps approvals for different sessions separate', async () => {
    await postJson(url, { sessionId: 'a', status: 'APPROVED' });
    await postJson(url, { sessionId: 'b', status: 'NEEDS_REVISION' });
    expect(server.getApprovals('a')).toHaveLength(1);
    expect(server.getApprovals('b')).toHaveLength(1);
    expect(server.getApprovals('a')[0].status).toBe('APPROVED');
    expect(server.getApprovals('b')[0].status).toBe('NEEDS_REVISION');
  });

  it('appends multiple POSTs to the same session', async () => {
    await postJson(url, { sessionId: 'multi', status: 'NEEDS_REVISION' });
    await postJson(url, { sessionId: 'multi', status: 'APPROVED' });
    const records = server.getApprovals('multi');
    expect(records).toHaveLength(2);
    expect(records[1].status).toBe('APPROVED');
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await new Promise<{ status: number }>((resolve, reject) => {
      const u = new URL(url);
      const req = http.request(
        { method: 'POST', hostname: u.hostname, port: Number(u.port), path: u.pathname,
          headers: { 'Content-Type': 'application/json' } },
        (r) => { r.on('data', () => {}); r.on('end', () => resolve({ status: r.statusCode || 0 })); }
      );
      req.on('error', reject);
      req.write('not json');
      req.end();
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown paths', async () => {
    const res = await new Promise<{ status: number }>((resolve, reject) => {
      const u = new URL(url);
      const req = http.request(
        { method: 'POST', hostname: u.hostname, port: Number(u.port), path: '/wrong' },
        (r) => { r.on('data', () => {}); r.on('end', () => resolve({ status: r.statusCode || 0 })); }
      );
      req.on('error', reject);
      req.end();
    });
    expect(res.status).toBe(404);
  });

  it('GET /health returns ok with port', async () => {
    const res = await getJson(`http://127.0.0.1:${server.getPort()}/health`);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).status).toBe('ok');
  });

  it('handles CORS preflight (OPTIONS)', async () => {
    const res = await new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const u = new URL(url);
      const req = http.request(
        { method: 'OPTIONS', hostname: u.hostname, port: Number(u.port), path: u.pathname },
        (r) => { r.on('data', () => {}); r.on('end', () => resolve({ status: r.statusCode || 0, headers: r.headers })); }
      );
      req.on('error', reject);
      req.end();
    });
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('clearApprovals removes by sessionId', () => {
    const record: ApprovalRecord = { status: 'APPROVED', sessionId: 'x', receivedAt: Date.now() };
    server.pushApproval(record);
    expect(server.getApprovals('x')).toHaveLength(1);
    server.clearApprovals('x');
    expect(server.getApprovals('x')).toHaveLength(0);
  });

  it('clearApprovals with no arg wipes all', () => {
    server.pushApproval({ status: 'APPROVED', sessionId: 'a', receivedAt: Date.now() });
    server.pushApproval({ status: 'APPROVED', sessionId: 'b', receivedAt: Date.now() });
    server.clearApprovals();
    expect(server.getApprovals('a')).toHaveLength(0);
    expect(server.getApprovals('b')).toHaveLength(0);
  });
});
