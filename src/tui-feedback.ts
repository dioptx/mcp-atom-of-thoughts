import * as fs from 'node:fs';
import * as path from 'node:path';
import { ApprovalResult, Rejection } from './types.js';
import { AtomFeedback, TuiState } from './tui-types.js';

export interface SubmitResult {
  filepath: string;
  status: ApprovalResult['status'];
  approvedCount: number;
  rejectedCount: number;
}

export function buildApprovalPayload(state: TuiState, title: string = 'AoT TUI verdict'): ApprovalResult {
  const approved: string[] = [];
  const rejections: Rejection[] = [];
  const phases: Record<string, string> = {};

  for (const [atomId, fb] of Object.entries(state.feedback)) {
    const atom = state.atoms[atomId];
    if (!atom) continue;
    if (fb.verdict === 'accepted') {
      approved.push(atomId);
      phases[atomId] = 'APPROVED';
    } else if (fb.verdict === 'rejected') {
      rejections.push({ nodeId: atomId, feedback: fb.note ?? 'rejected via TUI' });
      phases[atomId] = 'NEEDS_REVISION';
    }
  }

  const status: ApprovalResult['status'] = rejections.length > 0 ? 'NEEDS_REVISION' : 'APPROVED';
  return {
    status,
    timestamp: new Date().toISOString(),
    title,
    phases,
    rejections: rejections.length > 0 ? rejections : undefined,
    approvedNodes: approved.length > 0 ? approved : undefined,
  };
}

export function submitFeedback(state: TuiState): SubmitResult {
  const payload = buildApprovalPayload(state);
  const stamp = Date.now();
  const filename = `aot-approval-${stamp}.json`;
  const filepath = path.join(state.settings.feedbackDir, filename);
  fs.mkdirSync(state.settings.feedbackDir, { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(payload, null, 2));
  return {
    filepath,
    status: payload.status,
    approvedCount: payload.approvedNodes?.length ?? 0,
    rejectedCount: payload.rejections?.length ?? 0,
  };
}

export function recordFeedback(state: TuiState, atomId: string, fb: AtomFeedback): void {
  state.feedback[atomId] = fb;
}

export function clearFeedback(state: TuiState, atomId: string): void {
  delete state.feedback[atomId];
}
