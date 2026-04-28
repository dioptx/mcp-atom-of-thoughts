import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { URL } from 'node:url';
import { ApprovalResult, Rejection } from './types.js';
import { AtomFeedback, TuiState } from './tui-types.js';

export interface SubmitResult {
  source: 'http' | 'file';
  filepath?: string;
  url?: string;
  status: ApprovalResult['status'];
  approvedCount: number;
  rejectedCount: number;
}

export function buildApprovalPayload(state: TuiState, title: string = 'AoT TUI verdict'): ApprovalResult & { sessionId?: string } {
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
  const payload: ApprovalResult & { sessionId?: string } = {
    status,
    timestamp: new Date().toISOString(),
    title,
    phases,
    rejections: rejections.length > 0 ? rejections : undefined,
    approvedNodes: approved.length > 0 ? approved : undefined,
  };
  if (state.sessionId) payload.sessionId = state.sessionId;
  return payload;
}

/**
 * POST the approval JSON to the MCP server's local callback endpoint.
 * Resolves with the parsed response on 2xx, rejects on any other outcome.
 * Pure function over node:http — no globals, no external deps.
 */
export function postApproval(
  callbackUrl: string,
  payload: ApprovalResult & { sessionId?: string },
  timeoutMs: number = 1500,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(callbackUrl);
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      reject(new Error(`unsupported callback protocol: ${parsed.protocol}`));
      return;
    }
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let chunks = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { chunks += c; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(chunks)); } catch { resolve(chunks); }
          } else {
            reject(new Error(`callback returned ${res.statusCode}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('callback timeout')); });
    req.write(body);
    req.end();
  });
}

function writeFallbackFile(state: TuiState, payload: ApprovalResult & { sessionId?: string }): { filepath: string } {
  const stamp = Date.now();
  const filename = `aot-approval-${stamp}.json`;
  const filepath = path.join(state.settings.feedbackDir, filename);
  fs.mkdirSync(state.settings.feedbackDir, { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(payload, null, 2));
  return { filepath };
}

/**
 * Submit feedback to the LLM. Tries the HTTP callback first when one is
 * known; falls back to writing the approval JSON to the configured feedback
 * dir, which the file-polling path of `check_approval` already understands.
 */
export async function submitFeedback(state: TuiState): Promise<SubmitResult> {
  const payload = buildApprovalPayload(state);
  const approvedCount = payload.approvedNodes?.length ?? 0;
  const rejectedCount = payload.rejections?.length ?? 0;

  if (state.callbackUrl) {
    try {
      await postApproval(state.callbackUrl, payload);
      return { source: 'http', url: state.callbackUrl, status: payload.status, approvedCount, rejectedCount };
    } catch {
      // fall through to file fallback
    }
  }
  const { filepath } = writeFallbackFile(state, payload);
  return { source: 'file', filepath, status: payload.status, approvedCount, rejectedCount };
}

export function recordFeedback(state: TuiState, atomId: string, fb: AtomFeedback): void {
  state.feedback[atomId] = fb;
}

export function clearFeedback(state: TuiState, atomId: string): void {
  delete state.feedback[atomId];
}
