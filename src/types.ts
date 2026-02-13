export type AtomType = 'premise' | 'reasoning' | 'hypothesis' | 'verification' | 'conclusion';

export const VALID_ATOM_TYPES: AtomType[] = ['premise', 'reasoning', 'hypothesis', 'verification', 'conclusion'];

export interface AtomData {
  atomId: string;
  content: string;
  atomType: AtomType;
  dependencies: string[];
  confidence: number;
  created: number;
  isVerified: boolean;
  depth?: number;
}

export interface DecompositionState {
  originalAtomId: string;
  subAtoms: string[];
  isCompleted: boolean;
}

export interface GraphNode {
  id: string;
  type: AtomType;
  content: string;
  confidence: number;
  depth: number;
  isVerified?: boolean;
}

export interface GraphLink {
  source: string;
  target: string;
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
