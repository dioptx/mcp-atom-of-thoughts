import { spawnSync } from 'node:child_process';

export interface CommandResult {
  command: string;
  args: string[];
  status: number | null;
  stdout: string;
  stderr: string;
  combined: string;
}

export interface ExternalCommandErrorPayload {
  status: 'error';
  code: 'external_command_failed' | 'json_parse_failed';
  command: string;
  args: string[];
  exitCode?: number | null;
  message: string;
  stderrHint?: string;
  stdoutHint?: string;
}

export class ExternalCommandError extends Error {
  public readonly payload: ExternalCommandErrorPayload;

  constructor(payload: ExternalCommandErrorPayload) {
    super(JSON.stringify(payload));
    this.name = 'ExternalCommandError';
    this.payload = payload;
  }
}

function hint(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 800) : undefined;
}

export function commandErrorPayload(result: CommandResult, message?: string): ExternalCommandErrorPayload {
  return {
    status: 'error',
    code: 'external_command_failed',
    command: result.command,
    args: result.args,
    exitCode: result.status,
    message: message ?? `${result.command} ${result.args.join(' ')} failed (${result.status})`,
    stderrHint: hint(result.stderr),
    stdoutHint: hint(result.stdout),
  };
}

export function errorToPayload(error: unknown): ExternalCommandErrorPayload | { status: 'error'; code: 'unexpected_error'; message: string } {
  if (error instanceof ExternalCommandError) return error.payload;
  return { status: 'error', code: 'unexpected_error', message: error instanceof Error ? error.message : String(error) };
}

export function assertCommandOk(result: CommandResult, message?: string): void {
  if (result.status !== 0) throw new ExternalCommandError(commandErrorPayload(result, message));
}

export function commandAvailable(command: string, versionArgs: string[] = ['--version']): boolean {
  const proc = spawnSync(command, versionArgs, { encoding: 'utf8' });
  return !proc.error && proc.status === 0;
}

export function firstJson(text: string): unknown {
  const start = text.search(/[\[{]/);
  if (start < 0) {
    throw new ExternalCommandError({
      status: 'error',
      code: 'json_parse_failed',
      command: 'parse-json',
      args: [],
      message: `No JSON found in command output`,
      stdoutHint: text.slice(0, 800),
    });
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new ExternalCommandError({
    status: 'error',
    code: 'json_parse_failed',
    command: 'parse-json',
    args: [],
    message: 'Incomplete JSON in command output',
    stdoutHint: text.slice(start, start + 800),
  });
}

export function runCommand(command: string, args: string[], env?: NodeJS.ProcessEnv, cwd?: string, input?: string): CommandResult {
  const proc = spawnSync(command, args, { encoding: 'utf8', env: env ? { ...process.env, ...env } : process.env, cwd, input });
  return {
    command,
    args,
    status: proc.status,
    stdout: proc.stdout ?? '',
    stderr: proc.stderr ?? '',
    combined: `${proc.stdout ?? ''}\n${proc.stderr ?? ''}`,
  };
}

export function runJsonCommand(command: string, args: string[], env?: NodeJS.ProcessEnv, cwd?: string, input?: string): unknown {
  const result = runCommand(command, args, env, cwd, input);
  assertCommandOk(result);
  return firstJson(result.combined);
}
