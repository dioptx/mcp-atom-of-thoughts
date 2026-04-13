#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AtomOfThoughtsServer } from './atom-server.js';
import { AtomOfThoughtsLightServer } from './atom-light-server.js';
import { exportGraph } from './graph-export.js';
import { generateVisualizationHtml, writeVisualization, openInBrowser } from './visualization.js';
import { checkApproval } from './approval.js';
import { getTools } from './tools.js';
import { parseArgs } from './config.js';

const config = parseArgs(process.argv);

const server = new Server(
  { name: "@dioptx/mcp-atom-of-thoughts", version: "3.0.0-dev" },
  { capabilities: { tools: {} } }
);

const atomServer = (config.mode === 'full' || config.mode === 'both')
  ? new AtomOfThoughtsServer(config.maxDepth)
  : null;

const atomLightServer = (config.mode === 'fast' || config.mode === 'both')
  ? new AtomOfThoughtsLightServer(config.mode === 'fast' ? config.maxDepth : undefined)
  : null;

const tools = getTools(config);
const activeToolNames = new Set(tools.map(t => t.name));

type AtomResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

function shouldRenderViz(params: Record<string, unknown>): boolean {
  if (config.vizMode === 'never') return false;
  if (config.vizMode === 'always') return true;
  return params.viz === true;
}

function maybeAttachViz(
  result: AtomResult,
  params: Record<string, unknown>,
  target: AtomOfThoughtsServer,
): AtomResult {
  if (result.isError || !shouldRenderViz(params)) return result;

  try {
    const data = exportGraph(target.getAtoms(), target.getAtomOrder());
    const html = generateVisualizationHtml(data);
    const filepath = writeVisualization(html, undefined, undefined, config.outputDir);
    openInBrowser(filepath);

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(result.content[0].text);
    } catch {
      payload = { raw: result.content[0].text };
    }
    payload.viz = { filepath, atomCount: data.nodes.length, opened: true };

    return {
      ...result,
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  } catch (err) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(result.content[0].text);
    } catch {
      payload = { raw: result.content[0].text };
    }
    payload.viz = { error: err instanceof Error ? err.message : String(err) };
    return {
      ...result,
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  }
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const params = (args || {}) as Record<string, unknown>;

  if (!activeToolNames.has(name)) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }

  try {
    switch (name) {
      case "AoT-full":
        return maybeAttachViz(atomServer!.processAtom(params), params, atomServer!);

      case "AoT-fast":
        return maybeAttachViz(atomLightServer!.processAtom(params), params, atomLightServer!);

      case "atomcommands": {
        const command = params.command as string;
        const target = atomServer || atomLightServer!;
        let result: Record<string, unknown> = { status: 'error', message: 'Unknown command' };

        switch (command) {
          case 'decompose': {
            const atomId = params.atomId as string;
            if (!atomId) throw new Error('atomId is required for decompose command');
            const decompositionId = target.startDecomposition(atomId);
            result = { status: 'success', command: 'decompose', decompositionId, message: `Started decomposition of atom ${atomId}` };
            break;
          }
          case 'complete_decomposition': {
            const decompId = params.decompositionId as string;
            if (!decompId) throw new Error('decompositionId is required for complete_decomposition command');
            const completed = target.completeDecomposition(decompId);
            result = { status: 'success', command: 'complete_decomposition', completed, message: `Completed decomposition ${decompId}` };
            break;
          }
          case 'termination_status': {
            const status = target.getTerminationStatus();
            result = { status: 'success', command: 'termination_status', ...status };
            break;
          }
          case 'best_conclusion': {
            const best = target.getBestConclusion();
            result = { status: 'success', command: 'best_conclusion', conclusion: best ? { atomId: best.atomId, content: best.content, confidence: best.confidence } : null };
            break;
          }
          case 'set_max_depth': {
            const maxDepth = params.maxDepth as number;
            if (typeof maxDepth !== 'number' || maxDepth <= 0) throw new Error('maxDepth must be a positive number');
            target.maxDepth = maxDepth;
            result = { status: 'success', command: 'set_max_depth', maxDepth, message: `Maximum depth set to ${maxDepth}` };
            break;
          }
          case 'export': {
            const title = params.title as string | undefined;
            const data = exportGraph(target.getAtoms(), target.getAtomOrder(), title);
            result = { status: 'success', command: 'export', graph: data };
            break;
          }
          case 'check_approval': {
            const downloadsDir = (params.downloadsDir as string | undefined) || config.downloadsDir;
            const sessionStartTime = params.sessionStartTime as number | undefined;
            const approval = checkApproval(downloadsDir, sessionStartTime);
            result = { status: 'success', command: 'check_approval', approval };
            break;
          }
          case 'new_session': {
            const sessionId = params.sessionId as string | undefined;
            const created = target.newSession(sessionId);
            result = { status: 'success', command: 'new_session', sessionId: created, activeSessionId: target.getActiveSessionId() };
            break;
          }
          case 'switch_session': {
            const sessionId = params.sessionId as string;
            if (!sessionId) throw new Error('sessionId is required for switch_session');
            target.switchSession(sessionId);
            result = { status: 'success', command: 'switch_session', activeSessionId: target.getActiveSessionId() };
            break;
          }
          case 'list_sessions': {
            const sessions = target.listSessions();
            result = { status: 'success', command: 'list_sessions', activeSessionId: target.getActiveSessionId(), sessions };
            break;
          }
          case 'reset_session': {
            const sessionId = params.sessionId as string | undefined;
            target.resetSession(sessionId);
            result = { status: 'success', command: 'reset_session', sessionId: sessionId ?? target.getActiveSessionId() };
            break;
          }
          default:
            throw new Error(`Unknown atomcommands command: ${command}`);
        }

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: JSON.stringify({ status: 'error', error: error instanceof Error ? error.message : String(error) }, null, 2) }],
      isError: true
    };
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`@dioptx/mcp-atom-of-thoughts v3.0.0-dev | mode=${config.mode} viz=${config.vizMode} maxDepth=${config.maxDepth}`);
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
