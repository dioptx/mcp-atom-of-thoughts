import { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ServerConfig } from './config.js';

export const AOT_TOOL: Tool = {
  name: "AoT",
  description: `Atom of Thoughts (AoT) is a tool for solving complex problems by decomposing them into independent, reusable atomic units of thought.
Unlike traditional sequential thinking, this tool enables more powerful problem solving by allowing atomic units of thought to form dependencies with each other.

When to use:
- Solving problems requiring complex reasoning
- Generating hypotheses that need verification from multiple perspectives
- Deriving high-confidence conclusions in scenarios where accuracy is crucial
- Minimizing logical errors in critical tasks
- Decision-making requiring multiple verification steps

Atom types:
- premise: Basic assumptions or given information for problem solving
- reasoning: Logical reasoning process based on other atoms
- hypothesis: Proposed solutions or intermediate conclusions
- verification: Process to evaluate the validity of other atoms (especially hypotheses)
- conclusion: Verified hypotheses or final problem solutions

Parameter descriptions:
- atomId: Unique identifier for the atom (e.g., 'A1', 'H2')
- content: Actual content of the atom
- atomType: Type of atom (one of: premise, reasoning, hypothesis, verification, conclusion)
- dependencies: List of IDs of other atoms this atom depends on
- confidence: Confidence level of this atom (value between 0-1)
- isVerified: Whether this atom has been verified
- depth: Depth level of this atom (in the decomposition-contraction process)

Additional features:
1. Decomposition-Contraction mechanism:
   - Decompose atoms into smaller sub-atoms and contract back after verification
   - startDecomposition(atomId): Start atom decomposition
   - addToDecomposition(decompositionId, atomId): Add sub-atom to decomposition
   - completeDecomposition(decompositionId): Complete decomposition process

2. Automatic termination mechanism:
   - Automatically terminate when reaching maximum depth or finding high-confidence conclusion
   - getTerminationStatus(): Return termination status and reason
   - getBestConclusion(): Return highest confidence conclusion

Usage method:
1. Understand the problem and define necessary premise atoms
2. Create reasoning atoms based on premises
3. Create hypothesis atoms based on reasoning
4. Create verification atoms to verify hypotheses
5. Derive conclusion atoms based on verified hypotheses
6. Use atom decomposition to explore deeper when necessary
7. Present the high-confidence conclusion atom as the final answer`,
  inputSchema: {
    type: "object",
    properties: {
      atomId: { type: "string", description: "Unique identifier for the atom" },
      content: { type: "string", description: "Actual content of the atom" },
      atomType: { type: "string", enum: ["premise", "reasoning", "hypothesis", "verification", "conclusion"], description: "Type of atom" },
      dependencies: { type: "array", items: { type: "string" }, description: "List of IDs of other atoms this atom depends on" },
      confidence: { type: "number", minimum: 0, maximum: 1, description: "Confidence level of this atom (value between 0-1)" },
      isVerified: { type: "boolean", description: "Whether this atom has been verified" },
      depth: { type: "number", description: "Depth level of this atom in the decomposition-contraction mechanism" }
    },
    required: ["atomId", "content", "atomType", "dependencies", "confidence"]
  }
};

export const AOT_LIGHT_TOOL: Tool = {
  name: "AoT-light",
  description: `A lightweight version of Atom of Thoughts (AoT) designed for faster processing and quicker results.
This streamlined version sacrifices some depth of analysis for speed, making it ideal for time-sensitive reasoning tasks.

When to use:
- Quick brainstorming sessions requiring atomic thought organization
- Time-sensitive problem solving where speed is prioritized over exhaustive analysis
- Simpler reasoning tasks that don't require deep decomposition
- Initial exploration before using the full AoT for deeper analysis
- Learning or demonstration purposes where response time is important

Key differences from full AoT:
- Lower maximum depth (3 instead of 5) for faster processing
- Simplified verification process
- Immediate conclusion suggestion for high-confidence hypotheses
- Reduced computational overhead and response payload
- Optimized for speed rather than exhaustive analysis

Atom types and parameters are the same as the full AoT tool.`,
  inputSchema: {
    type: "object",
    properties: {
      atomId: { type: "string", description: "Unique identifier for the atom" },
      content: { type: "string", description: "Actual content of the atom" },
      atomType: { type: "string", enum: ["premise", "reasoning", "hypothesis", "verification", "conclusion"], description: "Type of atom" },
      dependencies: { type: "array", items: { type: "string" }, description: "List of IDs of other atoms this atom depends on" },
      confidence: { type: "number", minimum: 0, maximum: 1, description: "Confidence level of this atom (value between 0-1)" },
      isVerified: { type: "boolean", description: "Whether this atom has been verified" },
      depth: { type: "number", description: "Depth level of this atom (optional, defaults to 0)" }
    },
    required: ["atomId", "content", "atomType", "dependencies", "confidence"]
  }
};

export const ATOM_COMMANDS_TOOL: Tool = {
  name: "atomcommands",
  description: `A command tool to control the decomposition-contraction mechanism and automatic termination of Atom of Thoughts.

Use this tool to access advanced features of AoT:

1. Decomposition (decompose): Decompose a specified atom into smaller sub-atoms
2. Complete decomposition (complete_decomposition): Complete an ongoing decomposition process
3. Check termination status (termination_status): Check the termination status of the current AoT process
4. Get best conclusion (best_conclusion): Get the verified conclusion with the highest confidence
5. Change settings (set_max_depth): Change the maximum depth limit

Command descriptions:
- command: Command to execute (decompose, complete_decomposition, termination_status, best_conclusion, set_max_depth)
- atomId: Atom ID to use with the command (only required for decompose command)
- decompositionId: ID of the decomposition process (only required for complete_decomposition command)
- maxDepth: Maximum depth value to set (only required for set_max_depth command)`,
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
  description: `Export the current atom graph as a JSON object suitable for visualization or analysis.

Returns a GraphData object with:
- title: Graph title
- nodes: Array of {id, type, content, confidence, depth, isVerified}
- links: Array of {source, target} derived from atom dependencies

Use this to inspect the current state of the reasoning graph or to feed data into the generate_visualization tool.`,
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Optional title for the exported graph" }
    }
  }
};

export const GENERATE_VISUALIZATION_TOOL: Tool = {
  name: "generate_visualization",
  description: `Generate an interactive D3.js visualization of the atom graph and open it in the browser.

Creates an HTML file with:
- Interactive force-directed graph layout
- Phase-based approval sidebar
- Tooltips with atom details
- Approve/reject workflow per atom and phase
- Export/download of approval results

The visualization is written to the configured output directory and opened automatically.`,
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
  description: `Check for an AoT approval JSON file in the configured downloads directory.

After a visualization is opened in the browser and the user approves/rejects atoms,
the browser downloads an aot-approval-*.json file. This tool scans for that file
and returns the approval result.

Returns:
- {status: 'PENDING'} if no approval file found yet
- {status: 'APPROVED', ...} if all phases approved
- {status: 'NEEDS_REVISION', rejections: [...]} if some atoms rejected`,
  inputSchema: {
    type: "object",
    properties: {
      downloadsDir: { type: "string", description: "Override the downloads directory to scan" },
      sessionStartTime: { type: "number", description: "Unix timestamp of session start to ignore older files" }
    }
  }
};

export function getAllTools(): Tool[] {
  return [AOT_TOOL, AOT_LIGHT_TOOL, ATOM_COMMANDS_TOOL, EXPORT_GRAPH_TOOL, GENERATE_VISUALIZATION_TOOL, CHECK_APPROVAL_TOOL];
}

export function getTools(config: ServerConfig): Tool[] {
  const tools: Tool[] = [];

  if (config.mode === 'full' || config.mode === 'both') {
    tools.push(AOT_TOOL);
  }
  if (config.mode === 'fast' || config.mode === 'both') {
    tools.push(AOT_LIGHT_TOOL);
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
