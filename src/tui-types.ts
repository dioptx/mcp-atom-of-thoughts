import { AtomData } from './types.js';

export type FeedbackVerdict = 'accepted' | 'rejected' | 'starred';

export interface AtomFeedback {
  verdict: FeedbackVerdict;
  note?: string;
  at: number;
}

export interface TuiSettings {
  threshold: number;       // hide atoms below this confidence (0..1)
  autoScroll: boolean;
  compact: boolean;        // tighter tree
  showDeps: boolean;       // show dep ids inline
  theme: 'vibrant' | 'soft' | 'mono';
  feedbackDir: string;     // where approval JSON gets written
  sound: boolean;
}

export type TuiMode = 'main' | 'help' | 'settings' | 'note' | 'submitted';

export interface TuiState {
  atoms: Record<string, AtomData>;
  order: string[];
  termination: string | null;
  mode: string;            // server mode (full/fast/both)
  maxDepth: number;
  lastEventAt: number | null;
  decompositions: Set<string>;
  // Discovered from session_start events; used for HTTP submit + tagging.
  sessionId?: string;
  callbackUrl?: string;
  // UI state
  feedback: Record<string, AtomFeedback>;
  selectedIdx: number;     // index into the visible flat tree
  uiMode: TuiMode;
  settingsIdx: number;
  noteBuffer: string;
  paused: boolean;
  velocityBuckets: number[]; // events per ~1s window, last 30
  flash: { text: string; until: number } | null;
  settings: TuiSettings;
}

export function defaultSettings(feedbackDir: string): TuiSettings {
  return {
    threshold: 0,
    autoScroll: true,
    compact: false,
    showDeps: true,
    theme: 'vibrant',
    feedbackDir,
    sound: false,
  };
}
