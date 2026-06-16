#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function optionValue(name, fallback) {
  const argv = process.argv.slice(2);
  const equals = argv.find(arg => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) return argv[index + 1];
  return fallback;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const examplesDir = path.join(repoRoot, 'examples', 'personal-workflows');
const cliPath = path.join(repoRoot, 'build', 'cli.js');
const argv = process.argv.slice(2);
const args = new Set(argv);
const outRoot = path.resolve(repoRoot, optionValue('--out', 'out/personal-workflows'));
const dryRun = args.has('--dry-run') || args.has('--dryRun') || !args.has('--apply');
const includeLinear = !args.has('--no-linear');
const requested = argv.filter((arg, index) => !arg.startsWith('--') && argv[index - 1] !== '--out');

if (!existsSync(cliPath)) {
  throw new Error('Missing build/cli.js. Run: npm ci && npm run build');
}
if (!existsSync(examplesDir)) {
  throw new Error(`Missing examples directory: ${path.relative(repoRoot, examplesDir)}`);
}

const allFiles = readdirSync(examplesDir).filter(file => file.endsWith('.dag.json')).sort();
const files = args.has('--all') || requested.length === 0
  ? allFiles
  : requested.map(slug => slug.endsWith('.dag.json') ? slug : `${slug}.dag.json`);
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const summaries = [];
let failed = false;

mkdirSync(outRoot, { recursive: true });

for (const file of files) {
  const slug = file.replace(/\.dag\.json$/, '');
  const outDir = path.join(outRoot, slug, runId);
  mkdirSync(outDir, { recursive: true });
  const command = [
    'build/cli.js', 'dag', `@examples/personal-workflows/${file}`,
    ...(dryRun ? ['--dryRun'] : []),
    ...(includeLinear ? ['--linear'] : []),
    '--noGit', '--noBv', '--format', 'json'
  ];
  const commandEnvelope = { runId, cwd: repoRoot, command: [process.execPath, ...command], dryRun, includeLinear };
  writeFileSync(path.join(outDir, 'command.json'), JSON.stringify(commandEnvelope, null, 2) + '\n');

  if (!allFiles.includes(file)) {
    failed = true;
    const summary = { slug, runId, status: 'error', error: `Unknown workflow ${file}. Known: ${allFiles.join(', ')}` };
    writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    summaries.push(summary);
    console.error(`${slug}: ${summary.error}`);
    continue;
  }

  const proc = spawnSync(process.execPath, command, { cwd: repoRoot, encoding: 'utf8' });
  const pipelinePath = path.join(outDir, 'pipeline.json');
  writeFileSync(path.join(outDir, 'stdout.txt'), proc.stdout ?? '');
  writeFileSync(path.join(outDir, 'stderr.txt'), proc.stderr ?? '');

  let payload;
  let error;
  if (proc.status !== 0) {
    error = `${file} failed with exit ${proc.status}: ${proc.stderr}`;
  } else {
    try {
      payload = JSON.parse(proc.stdout);
    } catch (caught) {
      error = `${file} did not emit JSON: ${caught instanceof Error ? caught.message : String(caught)}`;
    }
  }

  if (error) {
    failed = true;
    const summary = { slug, runId, status: 'error', error, pipelinePath: path.relative(repoRoot, pipelinePath) };
    writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    summaries.push(summary);
    console.error(`${slug}: ${error}`);
    continue;
  }

  writeFileSync(pipelinePath, JSON.stringify(payload, null, 2) + '\n');
  const dag = JSON.parse(readFileSync(path.join(examplesDir, file), 'utf8'));
  const summary = {
    slug,
    runId,
    status: payload.status,
    dryRun: payload.dryRun,
    nodeCount: payload.dag?.nodeCount,
    edgeCount: payload.dag?.edgeCount,
    brCreates: payload.br?.createdCount,
    linearCreates: Array.isArray(payload.linear?.created) ? payload.linear.created.length : undefined,
    highRiskNodes: dag.nodes.filter(node => node.metadata?.safety).length,
    pipelinePath: path.relative(repoRoot, pipelinePath)
  };
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  summaries.push(summary);
  console.log(`${slug}: status=${summary.status} nodes=${summary.nodeCount} edges=${summary.edgeCount} highRisk=${summary.highRiskNodes} output=${summary.pipelinePath}`);
}
writeFileSync(path.join(outRoot, `summary-${runId}.json`), JSON.stringify({ runId, failed, summaries }, null, 2) + '\n');
if (failed) process.exit(1);
