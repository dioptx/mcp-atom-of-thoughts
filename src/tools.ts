import { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ServerConfig } from './config.js';

const SHARED_ATOM_SCHEMA = {
  type: "object" as const,
  properties: {
    atomId: { type: "string", description: "Unique identifier for the atom (e.g., 'P1', 'R1', 'H1', 'C1')" },
    content: { type: "string", description: "The thought content of this atom" },
    atomType: { type: "string", enum: ["premise", "reasoning", "hypothesis", "verification", "conclusion"], description: "Type of atom" },
    dependencies: { type: "array", items: { type: "string" }, description: "IDs of atoms this depends on (default: [])" },
    confidence: { type: "number", minimum: 0, maximum: 1, description: "Confidence 0-1 (default: 0.7)" },
    isVerified: { type: "boolean", description: "Whether this atom has been verified" },
    depth: { type: "number", description: "Depth level (auto-calculated if omitted)" },
    viz: { type: "boolean", description: "Render and open a D3 visualization of the current graph after this atom (default: false). Set true during planning or when the user is reviewing your reasoning; leave false during execution." },
    sessionId: { type: "string", description: "Target session for this atom (default: active session). Sessions isolate atom graphs so two reasoning problems in one process don't collide. Use atomcommands new_session/switch_session to manage explicitly. Auto-spawned on next zero-dep atom after a session terminates." }
  },
  required: ["atomId", "content", "atomType"]
};

export const AOT_FAST_TOOL: Tool = {
  name: "AoT-fast",
  description: `Default structured reasoning. Decomposes problems into atomic thoughts with dependency tracking. Depth 3.

Use for: think-through, analyze, reason about tradeoffs, debug root causes, evaluate alternatives, make decisions. Most reasoning tasks belong here.

Trigger phrases: "think through", "analyze", "reason about", "debug", "evaluate options", "compare approaches".

Atom types: premise (facts) → reasoning (logic) → hypothesis (proposals) → verification (checks) → conclusion (answer).

Minimal 3-call example:
  Call 1: {atomId:"P1", content:"The API returns 500 on POST /users", atomType:"premise"}
  Call 2: {atomId:"R1", content:"500 suggests unhandled exception in route handler", atomType:"reasoning", dependencies:["P1"]}
  Call 3: {atomId:"C1", content:"Add try-catch in POST /users handler", atomType:"conclusion", dependencies:["R1"], confidence:0.9}

Only atomId, content, and atomType are required. dependencies defaults to [], confidence defaults to 0.7.

Visualization: set viz:true when the user is reviewing your reasoning or you're in a planning context. Leave viz off during execution flows. The server can override via --viz always or --viz never.

Use AoT-full instead when you need >5 reasoning steps, multi-angle verification, or decomposition of sub-problems.`,
  inputSchema: SHARED_ATOM_SCHEMA
};

export const AOT_FULL_TOOL: Tool = {
  name: "AoT-full",
  description: `Deep structured reasoning with decomposition-contraction. Depth 5.

Use for: implementation plans, architecture decisions, multi-step verification, problems that decompose into sub-problems.

Trigger phrases: "plan", "design", "megathink", "full AoT", /aot-plan.

Same atom types and parameters as AoT-fast. Drives decomposition via the atomcommands tool (decompose → sub-atoms → complete_decomposition). Reach for AoT-fast first unless you genuinely need the extra depth or decomposition.

Visualization: set viz:true on your final conclusion atom (or when the user is about to review the plan) to open an interactive D3 graph. Leave off during pure execution.`,
  inputSchema: SHARED_ATOM_SCHEMA
};

export const ATOM_COMMANDS_TOOL: Tool = {
  name: "atomcommands",
  description: `Lifecycle and meta operations for the current AoT session.

Commands:
- decompose: Break an atom into sub-atoms (requires atomId)
- complete_decomposition: Finish a decomposition (requires decompositionId)
- termination_status: Check if reasoning should stop
- best_conclusion: Get the highest-confidence verified conclusion
- set_max_depth: Change max depth limit (requires maxDepth)
- export: Export the current atom graph as JSON for analysis or visualization (optional title)
- check_approval: Poll for browser-based approval decisions (optional downloadsDir, sessionStartTime)
- new_session: Create and switch to a new session (optional sessionId; auto-generated if omitted)
- switch_session: Activate an existing session (requires sessionId)
- list_sessions: List all sessions with status and atom counts
- reset_session: Wipe atoms in a session (defaults to active)`,
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        enum: [
          "decompose",
          "complete_decomposition",
          "termination_status",
          "best_conclusion",
          "set_max_depth",
          "export",
          "check_approval",
          "new_session",
          "switch_session",
          "list_sessions",
          "reset_session"
        ],
        description: "Command to execute"
      },
      atomId: { type: "string", description: "Atom ID (for decompose)" },
      decompositionId: { type: "string", description: "Decomposition ID (for complete_decomposition)" },
      maxDepth: { type: "number", description: "Maximum depth (for set_max_depth)" },
      title: { type: "string", description: "Optional title (for export)" },
      downloadsDir: { type: "string", description: "Override downloads directory (for check_approval)" },
      sessionStartTime: { type: "number", description: "Unix timestamp to ignore older approval files (for check_approval)" },
      sessionId: { type: "string", description: "Session ID (for new_session/switch_session/reset_session, optional for new_session/reset_session)" }
    },
    required: ["command"]
  }
};

export function getAllTools(): Tool[] {
  return [AOT_FAST_TOOL, AOT_FULL_TOOL, ATOM_COMMANDS_TOOL];
}

export function getTools(config: ServerConfig): Tool[] {
  const tools: Tool[] = [];

  // AoT-fast first (Claude favors earlier tools)
  if (config.mode === 'fast' || config.mode === 'both') {
    tools.push(AOT_FAST_TOOL);
  }
  if (config.mode === 'full' || config.mode === 'both') {
    tools.push(AOT_FULL_TOOL);
  }

  tools.push(ATOM_COMMANDS_TOOL);

  return tools;
}
