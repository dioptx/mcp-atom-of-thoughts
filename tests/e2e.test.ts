/**
 * End-to-end tests: spawn the built MCP server as a subprocess, talk to it
 * over stdio JSON-RPC via the official @modelcontextprotocol/sdk Client.
 *
 * These tests are the only ones that actually exercise:
 * - The src/index.ts dispatch switch (CallToolRequestSchema handler)
 * - Tool registration via ListToolsRequestSchema
 * - The maybeAttachViz helper wiring
 * - The atomcommands subcommand routing
 * - The approval-server starting at runtime
 *
 * They run against `build/index.js` so the build must be current.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as path from 'node:path';
import * as http from 'node:http';

const BUILD_PATH = path.resolve(__dirname, '..', 'build', 'index.js');

interface CallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function parseText(result: CallResult): Record<string, unknown> {
  return JSON.parse(result.content[0].text);
}

async function startClient(args: string[] = []): Promise<{
  client: Client;
  transport: StdioClientTransport;
  stderrChunks: string[];
  stop: () => Promise<void>;
}> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [BUILD_PATH, ...args],
    stderr: 'pipe',
  });
  const stderrChunks: string[] = [];
  if (transport.stderr) {
    transport.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk.toString());
    });
  }
  const client = new Client(
    { name: 'e2e-test-client', version: '1.0.0' },
    { capabilities: {} }
  );
  await client.connect(transport);
  return {
    client,
    transport,
    stderrChunks,
    stop: async () => {
      await client.close();
      await transport.close();
    },
  };
}

async function discoverApprovalPort(stderrChunks: string[], timeoutMs = 2000): Promise<number> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = stderrChunks.join('');
    const match = text.match(/approval=http:\/\/127\.0\.0\.1:(\d+)/);
    if (match) return Number(match[1]);
    await new Promise(r => setTimeout(r, 50));
  }
  return 0;
}

describe('e2e: MCP transport (default --viz auto)', () => {
  let session: Awaited<ReturnType<typeof startClient>>;

  beforeAll(async () => {
    session = await startClient();
  });

  afterAll(async () => {
    await session.stop();
  });

  it('tools/list returns exactly 3 v3 tools in order', async () => {
    const { tools } = await session.client.listTools();
    expect(tools).toHaveLength(3);
    expect(tools.map(t => t.name)).toEqual(['AoT-fast', 'AoT-full', 'atomcommands']);
  });

  it('AoT-fast call returns sessionId and atomsCount', async () => {
    const result = await session.client.callTool({
      name: 'AoT-fast',
      arguments: { atomId: 'P1', content: 'e2e premise', atomType: 'premise' },
    }) as CallResult;
    expect(result.isError).toBeFalsy();
    const data = parseText(result);
    expect(data.atomId).toBe('P1');
    expect(data.sessionId).toBe('default');
    expect(data.atomsCount).toBe(1);
  });

  it('AoT-fast respects dependencies in the same session', async () => {
    const result = await session.client.callTool({
      name: 'AoT-fast',
      arguments: {
        atomId: 'R1', content: 'follows from P1', atomType: 'reasoning',
        dependencies: ['P1'],
      },
    }) as CallResult;
    expect(result.isError).toBeFalsy();
    const data = parseText(result);
    expect(data.sessionId).toBe('default');
    expect(data.atomsCount).toBe(2);
  });

  it('atomcommands list_sessions returns the default session', async () => {
    const result = await session.client.callTool({
      name: 'atomcommands',
      arguments: { command: 'list_sessions' },
    }) as CallResult;
    const data = parseText(result);
    expect(data.command).toBe('list_sessions');
    expect(data.activeSessionId).toBe('default');
    const sessions = data.sessions as Array<{ id: string }>;
    expect(sessions.some(s => s.id === 'default')).toBe(true);
  });

  it('atomcommands new_session creates and switches', async () => {
    const result = await session.client.callTool({
      name: 'atomcommands',
      arguments: { command: 'new_session', sessionId: 'e2e-isolated' },
    }) as CallResult;
    const data = parseText(result);
    expect(data.command).toBe('new_session');
    expect(data.sessionId).toBe('e2e-isolated');
    expect(data.activeSessionId).toBe('e2e-isolated');
  });

  it('atom written after new_session lands in the new session', async () => {
    const result = await session.client.callTool({
      name: 'AoT-fast',
      arguments: { atomId: 'P1', content: 'isolated premise', atomType: 'premise' },
    }) as CallResult;
    const data = parseText(result);
    expect(data.sessionId).toBe('e2e-isolated');
    expect(data.atomsCount).toBe(1); // Fresh session, just one atom
  });

  it('atomcommands switch_session goes back to default', async () => {
    const result = await session.client.callTool({
      name: 'atomcommands',
      arguments: { command: 'switch_session', sessionId: 'default' },
    }) as CallResult;
    const data = parseText(result);
    expect(data.activeSessionId).toBe('default');
  });

  it('atomcommands export returns the graph', async () => {
    const result = await session.client.callTool({
      name: 'atomcommands',
      arguments: { command: 'export', title: 'e2e-export' },
    }) as CallResult;
    const data = parseText(result);
    expect(data.command).toBe('export');
    const graph = data.graph as { nodes: unknown[]; links: unknown[]; title: string };
    expect(graph.title).toBe('e2e-export');
    expect(graph.nodes.length).toBeGreaterThanOrEqual(2); // P1 + R1 from earlier
  });

  it('atomcommands check_approval returns PENDING with source field', async () => {
    const result = await session.client.callTool({
      name: 'atomcommands',
      arguments: { command: 'check_approval' },
    }) as CallResult;
    const data = parseText(result);
    expect(data.command).toBe('check_approval');
    expect(data.source).toMatch(/^(http|file)$/);
    // No POST has been sent, so http source should hit empty store and fall through to file
    // (which also returns PENDING since no file in tmp). Either way, status PENDING.
    const approval = data.approval as { status: string };
    expect(approval.status).toBe('PENDING');
  });

  it('atomcommands termination_status returns shouldTerminate boolean', async () => {
    const result = await session.client.callTool({
      name: 'atomcommands',
      arguments: { command: 'termination_status' },
    }) as CallResult;
    const data = parseText(result);
    expect(data.command).toBe('termination_status');
    expect(typeof data.shouldTerminate).toBe('boolean');
  });

  it('unknown atomcommands subcommand returns error in payload', async () => {
    const result = await session.client.callTool({
      name: 'atomcommands',
      arguments: { command: 'nonexistent' as never },
    }) as CallResult;
    expect(result.isError).toBe(true);
  });

  it('AoT-full processAtom works via dispatch', async () => {
    const result = await session.client.callTool({
      name: 'AoT-full',
      arguments: { atomId: 'P_full', content: 'full mode premise', atomType: 'premise' },
    }) as CallResult;
    expect(result.isError).toBeFalsy();
    const data = parseText(result);
    expect(data.atomId).toBe('P_full');
  });

  it('viz: false (or omitted) does not include viz field in response', async () => {
    const result = await session.client.callTool({
      name: 'AoT-fast',
      arguments: { atomId: 'P_noviz', content: 'no viz', atomType: 'premise' },
    }) as CallResult;
    const data = parseText(result);
    expect(data).not.toHaveProperty('viz');
  });
});

describe('e2e: --viz never suppresses rendering', () => {
  let session: Awaited<ReturnType<typeof startClient>>;

  beforeAll(async () => {
    session = await startClient(['--viz', 'never']);
  });

  afterAll(async () => {
    await session.stop();
  });

  it('viz: true is ignored when --viz never', async () => {
    const result = await session.client.callTool({
      name: 'AoT-fast',
      arguments: {
        atomId: 'P1', content: 'should not render', atomType: 'premise',
        viz: true,
      },
    }) as CallResult;
    const data = parseText(result);
    expect(data).not.toHaveProperty('viz');
  });
});

describe('e2e: --mode fast registers only AoT-fast + atomcommands', () => {
  let session: Awaited<ReturnType<typeof startClient>>;

  beforeAll(async () => {
    session = await startClient(['--mode', 'fast', '--viz', 'never']);
  });

  afterAll(async () => {
    await session.stop();
  });

  it('tools/list excludes AoT-full', async () => {
    const { tools } = await session.client.listTools();
    const names = tools.map(t => t.name);
    expect(names).toContain('AoT-fast');
    expect(names).not.toContain('AoT-full');
    expect(names).toContain('atomcommands');
  });

  it('calling AoT-full returns Unknown tool error', async () => {
    const result = await session.client.callTool({
      name: 'AoT-full',
      arguments: { atomId: 'P1', content: 'x', atomType: 'premise' },
    }) as CallResult;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });
});

describe('e2e: HTTP approval callback round-trip', () => {
  let session: Awaited<ReturnType<typeof startClient>>;
  let callbackPort: number = 0;

  beforeAll(async () => {
    session = await startClient(['--viz', 'never']);
    callbackPort = await discoverApprovalPort(session.stderrChunks);
  });

  afterAll(async () => {
    await session.stop();
  });

  it('discovered an approval callback port', () => {
    expect(callbackPort).toBeGreaterThan(0);
  });

  it('POST to /approval is reflected in atomcommands check_approval', async () => {
    if (!callbackPort) return; // skipped if port discovery failed

    // Add an atom so the session has content
    await session.client.callTool({
      name: 'AoT-fast',
      arguments: { atomId: 'P1', content: 'p', atomType: 'premise' },
    });

    // POST a fake approval to the callback URL
    const body = JSON.stringify({
      sessionId: 'default',
      status: 'APPROVED',
      title: 'e2e roundtrip',
      approvedNodes: ['P1'],
    });
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        { method: 'POST', hostname: '127.0.0.1', port: callbackPort, path: '/approval',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        (res) => { res.on('data', () => {}); res.on('end', () => resolve()); }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    // Now check_approval should return the http source with the APPROVED record
    const result = await session.client.callTool({
      name: 'atomcommands',
      arguments: { command: 'check_approval' },
    }) as CallResult;
    const data = parseText(result);
    expect(data.source).toBe('http');
    const approval = data.approval as { status: string; sessionId: string; approvedNodes: string[] };
    expect(approval.status).toBe('APPROVED');
    expect(approval.sessionId).toBe('default');
    expect(approval.approvedNodes).toEqual(['P1']);
  });
});
