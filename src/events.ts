import * as fs from 'node:fs';
import * as path from 'node:path';
import { AtomData } from './types.js';

export type AotEvent =
  | { kind: 'session_start'; t: number; mode: string; maxDepth: number; sessionId?: string }
  | { kind: 'atom_added'; t: number; atom: AtomData; sessionId?: string }
  | { kind: 'atom_verified'; t: number; atomId: string; confidence: number; sessionId?: string }
  | { kind: 'conclusion_suggested'; t: number; atomId: string; fromHypothesis: string; confidence: number; sessionId?: string }
  | { kind: 'decomposition_started'; t: number; decompositionId: string; atomId: string; sessionId?: string }
  | { kind: 'decomposition_completed'; t: number; decompositionId: string; sessionId?: string }
  | { kind: 'termination'; t: number; reason: string; sessionId?: string };

export class EventLog {
  private fd: number | null = null;
  private path: string;
  private enabled: boolean;

  constructor(filePath: string, enabled: boolean = true) {
    this.path = filePath;
    this.enabled = enabled;
    if (this.enabled) {
      this.open();
    }
  }

  private open(): void {
    try {
      fs.mkdirSync(path.dirname(this.path), { recursive: true });
      this.fd = fs.openSync(this.path, 'a');
    } catch (e) {
      this.enabled = false;
      this.fd = null;
    }
  }

  emit(event: AotEvent): void {
    if (!this.enabled || this.fd === null) return;
    try {
      fs.writeSync(this.fd, JSON.stringify(event) + '\n');
    } catch {
      // Silently ignore — TUI logging never blocks reasoning.
    }
  }

  close(): void {
    if (this.fd !== null) {
      try { fs.closeSync(this.fd); } catch { /* ignore */ }
      this.fd = null;
    }
  }

  getPath(): string {
    return this.path;
  }
}

export function defaultEventsPath(outputDir: string): string {
  return path.join(outputDir, 'aot-events.jsonl');
}
