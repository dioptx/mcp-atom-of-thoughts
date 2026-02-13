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
  { name: "@dioptx/mcp-atom-of-thoughts", version: "2.0.0" },
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
      case "AoT":
        return atomServer!.processAtom(params);

      case "AoT-light":
        return atomLightServer!.processAtom(params);

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
        }

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "export_graph": {
        const title = params.title as string | undefined;
        const target = atomServer || atomLightServer!;
        const data = exportGraph(target.getAtoms(), target.getAtomOrder(), title);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "generate_visualization": {
        const title = params.title as string | undefined;
        const outputDir = params.outputDir as string | undefined;
        const target = atomServer || atomLightServer!;
        const data = exportGraph(target.getAtoms(), target.getAtomOrder(), title);
        const html = generateVisualizationHtml(data);
        const filepath = writeVisualization(html, outputDir, undefined, config.outputDir);
        openInBrowser(filepath);
        return { content: [{ type: "text", text: JSON.stringify({ status: 'success', filepath, atomCount: data.nodes.length, linkCount: data.links.length }, null, 2) }] };
      }

      case "check_approval": {
        const downloadsDir = (params.downloadsDir as string | undefined) || config.downloadsDir;
        const sessionStartTime = params.sessionStartTime as number | undefined;
        const approval = checkApproval(downloadsDir, sessionStartTime);
        return { content: [{ type: "text", text: JSON.stringify(approval, null, 2) }] };
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
  console.error(`@dioptx/mcp-atom-of-thoughts v2.0.0 | mode=${config.mode} viz=${config.vizEnabled} approval=${config.approvalEnabled} maxDepth=${config.maxDepth}`);
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
