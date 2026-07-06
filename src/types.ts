export type AtomType = 'premise' | 'reasoning' | 'hypothesis' | 'verification' | 'conclusion';

export const VALID_ATOM_TYPES: AtomType[] = ['premise', 'reasoning', 'hypothesis', 'verification', 'conclusion'];

/**
 * Direction of a verification atom's evidence. 'supports' (default) verifies
 * its hypothesis dependencies when the verification itself is verified;
 * 'refutes' marks them refuted instead — negative evidence is first-class,
 * never silently inverted into support.
 */
export type VerificationPolarity = 'supports' | 'refutes';

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
