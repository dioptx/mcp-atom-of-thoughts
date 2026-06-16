import * as fs from 'node:fs';
import { assertCommandOk, commandAvailable, firstJson, runCommand } from './shell-json.js';

export type BvRobotCommand = 'triage' | 'insights' | 'plan' | 'priority' | 'next' | 'alerts' | 'metrics' | 'label-health' | 'label-attention' | 'suggest';

export interface BvOptions {
  db?: string;
  format?: 'json' | 'toon';
  maxResults?: number;
  label?: string;
  minConfidence?: number;
  noCache?: boolean;
  command?: string;
  cwd?: string;
}

const COMMAND_FLAGS: Record<BvRobotCommand, string> = {
  triage: '--robot-triage',
  insights: '--robot-insights',
  plan: '--robot-plan',
  priority: '--robot-priority',
  next: '--robot-next',
  alerts: '--robot-alerts',
  metrics: '--robot-metrics',
  'label-health': '--robot-label-health',
  'label-attention': '--robot-label-attention',
  suggest: '--robot-suggest',
};

function bvCommand(options: BvOptions = {}): string {
  if (options.command ?? process.env.AOT_BV_BIN) return options.command ?? process.env.AOT_BV_BIN ?? 'bv';
  if (fs.existsSync('/opt/homebrew/bin/bv')) return '/opt/homebrew/bin/bv';
  if (fs.existsSync('/usr/local/bin/bv')) return '/usr/local/bin/bv';
  return 'bv';
}

export function bvCommandAvailable(options: BvOptions = {}): boolean {
  return commandAvailable(bvCommand(options), ['--version']);
}

export function runBvRobot(robotCommand: BvRobotCommand, options: BvOptions = {}): Record<string, unknown> {
  const command = bvCommand(options);
  const args: string[] = [COMMAND_FLAGS[robotCommand], '-f', options.format ?? 'json'];
  if (options.db) args.push('--db', options.db);
  if (options.maxResults !== undefined) args.push('--robot-max-results', String(options.maxResults));
  if (options.label) args.push('--label', options.label);
  if (options.minConfidence !== undefined) args.push('--robot-min-confidence', String(options.minConfidence));
  if (options.noCache) args.push('--no-cache');

  const result = runCommand(command, args, undefined, options.cwd);
  assertCommandOk(result);
  if ((options.format ?? 'json') === 'json') {
    return firstJson(result.combined) as Record<string, unknown>;
  }
  return { format: 'toon', text: result.stdout.trim() || result.stderr.trim() };
}

export function summarizeBvRobot(robotCommand: BvRobotCommand, payload: Record<string, unknown>): Record<string, unknown> {
  const triage = payload.triage as Record<string, unknown> | undefined;
  const quickRef = triage?.quick_ref as Record<string, unknown> | undefined;
  if (quickRef) {
    return {
      command: robotCommand,
      openCount: quickRef.open_count,
      actionableCount: quickRef.actionable_count,
      blockedCount: quickRef.blocked_count,
      topPicks: quickRef.top_picks,
    };
  }
  return { command: robotCommand, keys: Object.keys(payload).slice(0, 12) };
}
