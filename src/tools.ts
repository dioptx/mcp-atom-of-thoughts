import { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ServerConfig } from './config.js';

export const AOT_LIGHT_TOOL: Tool = {
  name: "AoT-light",
  description: `RECOMMENDED default reasoning tool. Decomposes problems into atomic thoughts with dependency tracking. Fast (depth 3), ideal for most tasks.

Use when you need to: think through a problem, analyze options, reason about tradeoffs, debug root causes, evaluate alternatives, or make decisions.

Trigger phrases: "think through", "analyze", "reason about", "debug", "evaluate options", "compare approaches"

Atom types: premise (facts) → reasoning (logic) → hypothesis (proposals) → verification (checks) → conclusion (answer)

Minimal 3-call example:
  Call 1: {atomId:"P1", content:"The API returns 500 on POST /users", atomType:"premise"}
  Call 2: {atomId:"R1", content:"500 suggests unhandled exception in route handler", atomType:"reasoning", dependencies:["P1"]}
  Call 3: {atomId:"C1", content:"Add try-catch in POST /users handler", atomType:"conclusion", dependencies:["R1"], confidence:0.9}

Only atomId, content, and atomType are required. dependencies defaults to [], confidence defaults to 0.7.`,
  inputSchema: {
    type: "object",
    properties: {
      atomId: { type: "string", description: "Unique identifier for the atom (e.g., 'P1', 'R1', 'H1', 'C1')" },
      content: { type: "string", description: "The thought content of this atom" },
      atomType: { type: "string", enum: ["premise", "reasoning", "hypothesis", "verification", "conclusion"], description: "Type of atom" },
      dependencies: { type: "array", items: { type: "string" }, description: "IDs of atoms this depends on (default: [])" },
      confidence: { type: "number", minimum: 0, maximum: 1, description: "Confidence 0-1 (default: 0.7)" },
      isVerified: { type: "boolean", description: "Whether this atom has been verified" },
      depth: { type: "number", description: "Depth level (auto-calculated if omitted)" }
    },
    required: ["atomId", "content", "atomType"]
  }
};

export const AOT_TOOL: Tool = {
  name: "AoT",
  description: `ADVANCED: Full Atom of Thoughts with decomposition-contraction (depth 5). Use AoT-light instead for most tasks.

Use full AoT only when: >5 reasoning steps needed, multi-angle verification required, or decomposing complex sub-problems.

Adds decomposition-contraction: break atoms into sub-atoms, verify independently, contract back. Use atomcommands tool for decomposition controls.

Same atom types and parameters as AoT-light. dependencies defaults to [], confidence defaults to 0.7.`,
  inputSchema: {
    type: "object",
    properties: {
      atomId: { type: "string", description: "Unique identifier for the atom (e.g., 'P1', 'R1', 'H1', 'C1')" },
      content: { type: "string", description: "The thought content of this atom" },
      atomType: { type: "string", enum: ["premise", "reasoning", "hypothesis", "verification", "conclusion"], description: "Type of atom" },
      dependencies: { type: "array", items: { type: "string" }, description: "IDs of atoms this depends on (default: [])" },
      confidence: { type: "number", minimum: 0, maximum: 1, description: "Confidence 0-1 (default: 0.7)" },
      isVerified: { type: "boolean", description: "Whether this atom has been verified" },
      depth: { type: "number", description: "Depth level (auto-calculated if omitted)" }
    },
    required: ["atomId", "content", "atomType"]
  }
};

export const ATOM_COMMANDS_TOOL: Tool = {
  name: "atomcommands",
  description: `Control decomposition-contraction and termination for full AoT sessions.

Commands:
- decompose: Break an atom into sub-atoms (requires atomId)
- complete_decomposition: Finish a decomposition (requires decompositionId)
- termination_status: Check if reasoning should stop
- best_conclusion: Get the highest-confidence verified conclusion
- set_max_depth: Change max depth limit (requires maxDepth)`,
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", enum: ["decompose", "complete_decomposition", "termination_status", "best_conclusion", "set_max_depth"], description: "Command to execute" },
      atomId: { type: "string", description: "Atom ID to use with the command" },
      decompositionId: { type: "string", description: "ID of the decomposition process to complete" },
      maxDepth: { type: "number", description: "Maximum depth value to set" }
    },
    required: ["command"]
  }
};

export const EXPORT_GRAPH_TOOL: Tool = {
  name: "export_graph",
  description: `Export the current atom graph as JSON with nodes and links for visualization or analysis.`,
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Optional title for the exported graph" }
    }
  }
};

export const GENERATE_VISUALIZATION_TOOL: Tool = {
  name: "generate_visualization",
  description: `Generate an interactive D3.js visualization of the atom graph and open it in the browser.`,
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Title for the visualization" },
      outputDir: { type: "string", description: "Override the output directory for this visualization" }
    }
  }
};

export const CHECK_APPROVAL_TOOL: Tool = {
  name: "check_approval",
  description: `Check for an AoT approval JSON file in the downloads directory after browser-based review.`,
  inputSchema: {
    type: "object",
    properties: {
      downloadsDir: { type: "string", description: "Override the downloads directory to scan" },
      sessionStartTime: { type: "number", description: "Unix timestamp of session start to ignore older files" }
    }
  }
};

export function getAllTools(): Tool[] {
  return [AOT_LIGHT_TOOL, AOT_TOOL, ATOM_COMMANDS_TOOL, EXPORT_GRAPH_TOOL, GENERATE_VISUALIZATION_TOOL, CHECK_APPROVAL_TOOL];
}

export function getTools(config: ServerConfig): Tool[] {
  const tools: Tool[] = [];

  // AoT-light first (Claude favors earlier tools)
  if (config.mode === 'fast' || config.mode === 'both') {
    tools.push(AOT_LIGHT_TOOL);
  }
  if (config.mode === 'full' || config.mode === 'both') {
    tools.push(AOT_TOOL);
  }

  tools.push(ATOM_COMMANDS_TOOL);
  tools.push(EXPORT_GRAPH_TOOL);

  if (config.vizEnabled) {
    tools.push(GENERATE_VISUALIZATION_TOOL);
  }
  if (config.approvalEnabled) {
    tools.push(CHECK_APPROVAL_TOOL);
  }

  return tools;
}
