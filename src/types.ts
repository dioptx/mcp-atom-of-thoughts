export type AtomType = 'premise' | 'reasoning' | 'hypothesis' | 'verification' | 'conclusion';

export const VALID_ATOM_TYPES: AtomType[] = ['premise', 'reasoning', 'hypothesis', 'verification', 'conclusion'];

/**
 * Direction of a verification atom's evidence. 'supports' (default) verifies
 * its hypothesis dependencies when the verification itself is verified;
 * 'refutes' marks them refuted instead — negative evidence is first-class,
 * never silently inverted into support.
 */
export type VerificationPolarity = 'supports' | 'refutes';

/**
 * Provenance link from an atom to an external sgt skill (skill-graph-traversal
 * bridge). Optional and purely additive — atoms without it are unaffected.
 */
export interface SkillRef {
  slug: string;
  source: 'sgt';
  score?: number;
  coverage?: number;
  /**
   * Query-token diagnostics from sgt's semantic/query-dag paths (round 2,
   * additive). Absent and [] are DISTINCT states (spec §2c): absent means
   * "sgt reported nothing", [] means "sgt reported an empty list".
   */
  matchedTokens?: string[];
  missingTokens?: string[];
}

export interface AtomData {
  atomId: string;
  content: string;
  atomType: AtomType;
  dependencies: string[];
  confidence: number;
  created: number;
  isVerified: boolean;
  depth?: number;
  /** Only meaningful on verification atoms. Defaults to 'supports'. */
  polarity?: VerificationPolarity;
  /** Set by a verified refuting verification; mutually exclusive with isVerified. */
  isRefuted?: boolean;
  /** Evidence artifact references (file paths, URLs). */
  evidence?: string[];
  /** sgt bridge provenance (skill hypotheses); optional, backward compatible. */
  skillRef?: SkillRef;
}

// ---------------------------------------------------------------------------
// Systems-thinking layer: signed causal links over the SAME atoms.
// The epistemic DAG says "what we believe and why"; the causal layer says
// "how the believed system behaves". Causal cycles are LEGAL (feedback loops).
// ---------------------------------------------------------------------------

/** Signed causal influence: '+' same direction, '-' opposite. */
export type CausalSign = '+' | '-';
export type CausalGain = 'low' | 'med' | 'high';

export interface CausalLink {
  /** Stable id: `cl:${from}>${to}` — one link per (from,to) pair per session. */
  id: string;
  from: string;
  to: string;
  sign: CausalSign;
  /** Defaults to 'med' at write time. */
  gain?: CausalGain;
  label?: string;
  /** Epoch ms; render as ISO in CLI output. */
  created: number;
}

export interface CausalGraphInput {
  atoms: Record<string, AtomData>;
  causalLinks: CausalLink[];
}

export type LoopKind = 'reinforcing' | 'balancing';

export interface LoopEdgeRef {
  from: string;
  to: string;
  sign: CausalSign;
  gain: CausalGain; // resolved (default 'med' applied)
  linkId: string;
}

/**
 * Loop id: `loop:${atoms.join('>')}` after canonical rotation
 * (lexicographically smallest atom id first, edge-walk order preserved).
 * Deterministic across runs and input orderings.
 */
export interface LoopAnalysis {
  id: string;
  kind: LoopKind;
  atoms: string[]; // in edge-walk order, canonical rotation
  edges: LoopEdgeRef[];
  negativeSignCount: number;
  positiveSignCount: number;
  loopGain: number; // product of numeric edge gains
  /**
   * min effectiveConfidence over loop atoms, computed on the FULL atom set
   * (before refuted atoms are filtered out) so atoms resting on refuted
   * support keep their zeroed confidence.
   */
  confidenceWeight: number;
}

export type ControlRole = 'sensor' | 'actuator' | 'goal' | 'disturbance' | 'connector';

export interface ControlLoopAnalysis {
  loopId: string;
  loopKind: LoopKind;
  /** atomId -> roles; includes external disturbance atoms with ['disturbance']. */
  roles: Record<string, ControlRole[]>;
  /** Non-loop atoms with an active causal link INTO a loop atom. */
  externalDisturbances: string[];
  hasSensor: boolean;
  hasGoal: boolean;
  hasActuator: boolean;
  isClosedControlLoop: boolean; // balancing && hasSensor && hasGoal
  isOpenLoopRisk: boolean; // balancing && !hasSensor
}

// ---- Round 2 types (declared now for stability, implemented later) ----

export type LeverageRationaleCode =
  | 'LOOP_HUB' | 'HIGH_CAUSAL_OUT_DEGREE' | 'REINFORCING_DRIVER' | 'BALANCING_DRIVER'
  | 'HIGH_EFFECTIVE_CONFIDENCE' | 'LOW_EFFECTIVE_CONFIDENCE' | 'ACTUATOR_ROLE' | 'SENSOR_ROLE';

export interface LeveragePoint {
  atomId: string;
  rank: number;
  /** Normalized 0-1; all zero (not NaN) when every raw score is 0. */
  score: number;
  effectiveConfidence: number;
  loopCount: number;
  causalOutDegree: number;
  rationaleCodes: LeverageRationaleCode[];
}

export type SimDirection = 'up' | 'down' | 'ambiguous';

export interface SimulationEffect {
  atomId: string;
  direction: SimDirection;
  provenance: 'first-order' | 'loop-mediated' | 'emergent';
  pathLinkIds: string[]; // one witness path (deterministic first-found)
  strength: number; // damped, 0-1
}

export interface SimulationResult {
  sourceAtomId: string;
  inputDirection: 'up' | 'down';
  effects: SimulationEffect[];
  loopsTraversed: string[];
  ambiguousAtomIds: string[];
  emergentAtomIds: string[];
}

export type SystemsIssueCode =
  | 'REINFORCING_COMPOUNDING_RISK' | 'LOOP_CONTRADICTS_CONCLUSION'
  | 'BALANCING_LOOP_NO_SENSOR' | 'OPEN_LOOP_BALANCING_RISK'
  | 'ORPHAN_CAUSAL_LINK' | 'SELF_LOOP' | 'DUPLICATE_CAUSAL_LINK'
  | 'LOOP_ENUMERATION_TRUNCATED';

export interface SystemsIssue {
  code: SystemsIssueCode;
  atomIds: string[];
  loopIds?: string[];
  message: string;
}

export interface SystemsAnalysis {
  loops: LoopAnalysis[];
  controlLoops: ControlLoopAnalysis[];
  leveragePoints: LeveragePoint[];
  issues: SystemsIssue[];
  /** True when loop enumeration hit MAX_LOOP_COUNT — downstream results may be incomplete. */
  truncated: boolean;
}

export interface DecompositionState {
  originalAtomId: string;
  subAtoms: string[];
  isCompleted: boolean;
}

export type SessionStatus = 'active' | 'completed';

export interface Session {
  id: string;
  status: SessionStatus;
  createdAt: number;
  atoms: Record<string, AtomData>;
  atomOrder: string[];
  verifiedConclusions: string[];
  decompositionStates: Record<string, DecompositionState>;
  currentDecompositionId: string | null;
  /** Absent in pre-systems-layer state files; normalized to [] on access. */
  causalLinks?: CausalLink[];
}

export interface SessionSummary {
  id: string;
  status: SessionStatus;
  atomCount: number;
  createdAt: number;
}

export interface GraphNode {
  id: string;
  type: AtomType;
  content: string;
  confidence: number;
  depth: number;
  isVerified?: boolean;
  polarity?: VerificationPolarity;
  isRefuted?: boolean;
  evidence?: string[];
  /**
   * sgt bridge provenance (round 3): carried through export/import so skill
   * atoms stay tagged in renders and file-based analysis. Omitted entirely
   * when absent — exports without skill atoms are byte-identical to pre-sgt
   * payloads.
   */
  skillRef?: SkillRef;
  title?: string;
  labels?: string[];
  priority?: string;
  description?: string;
  externalRef?: string;
}

export interface GraphLink {
  source: string;
  target: string;
  relation?: string;
  blocking?: boolean;
  description?: string;
}

export interface GraphData {
  title: string;
  nodes: GraphNode[];
  links: GraphLink[];
  /** Signed causal layer; absent when the session has no causal links. Old readers ignore it. */
  causalLinks?: CausalLink[];
}

export interface Rejection {
  nodeId: string;
  feedback: string;
}

export interface ApprovalResult {
  status: 'APPROVED' | 'NEEDS_REVISION' | 'PENDING' | 'TIMEOUT';
  timestamp?: string;
  title?: string;
  phases?: Record<string, string>;
  rejections?: Rejection[];
  approvedNodes?: string[];
}
