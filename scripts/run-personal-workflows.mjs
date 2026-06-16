#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const examplesDir = path.join(repoRoot, 'examples', 'personal-workflows');
const args = new Set(process.argv.slice(2));
const outRootArg = process.argv.find(arg => arg.startsWith('--out='));
const outRoot = path.resolve(repoRoot, outRootArg ? outRootArg.slice('--out='.length) : 'out/personal-workflows');
const dryRun = args.has('--dry-run') || args.has('--dryRun') || !args.has('--apply');
const includeLinear = !args.has('--no-linear');
const requested = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const allFiles = readdirSync(examplesDir).filter(file => file.endsWith('.dag.json')).sort();
const files = args.has('--all') || requested.length === 0
  ? allFiles
  : requested.map(slug => slug.endsWith('.dag.json') ? slug : `${slug}.dag.json`);
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const summaries = [];

for (const file of files) {
  if (!allFiles.includes(file)) throw new Error(`Unknown workflow ${file}. Known: ${allFiles.join(', ')}`);
  const slug = file.replace(/\.dag\.json$/, '');
  const outDir = path.join(outRoot, slug, runId);
  mkdirSync(outDir, { recursive: true });
  const command = [
    'build/cli.js', 'dag', `@examples/personal-workflows/${file}`,
    ...(dryRun ? ['--dryRun'] : []),
    ...(includeLinear ? ['--linear'] : []),
    '--noGit', '--noBv', '--format', 'json'
  ];
  const proc = spawnSync(process.execPath, command, { cwd: repoRoot, encoding: 'utf8' });
  const pipelinePath = path.join(outDir, 'pipeline.json');
  writeFileSync(path.join(outDir, 'command.json'), JSON.stringify({ runId, cwd: repoRoot, command: [process.execPath, ...command], dryRun, includeLinear }, null, 2) + '\n');
  writeFileSync(path.join(outDir, 'stdout.txt'), proc.stdout ?? '');
  writeFileSync(path.join(outDir, 'stderr.txt'), proc.stderr ?? '');
  if (proc.status !== 0) throw new Error(`${file} failed with exit ${proc.status}: ${proc.stderr}`);
  let payload;
  try {
    payload = JSON.parse(proc.stdout);
  } catch (error) {
    throw new Error(`${file} did not emit JSON: ${error instanceof Error ? error.message : String(error)}`);
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
writeFileSync(path.join(outRoot, `summary-${runId}.json`), JSON.stringify({ runId, summaries }, null, 2) + '\n');
