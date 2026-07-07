export const meta = {
  name: 'ab-integration-loop',
  description: 'Self-improving A/B loop OVER the aot<->sgt integration: interleaved sgt-disclosure+aot-tracing vs raw sgt retrieval',
  phases: [
    { title: 'Plan' }, { title: 'Baseline A/B' }, { title: 'Judge' },
    { title: 'Round 1' }, { title: 'Round 2' },
  ],
}

const REPO = '/Users/mikhail/Dev/ai-dev/mcp-atom-of-thoughts'
const SGT = '/Users/mikhail/.local/bin/sgt'
const TASKS = `${REPO}/bench/ab-loop/integration-tasks.jsonl`
const PAD = '/private/tmp/claude-501/-Users-mikhail/494bff0f-794d-45ce-b2a4-ff59b12e384a/scratchpad/abi'
const K = 3
const MAX_ROUNDS = 2

const W = { correct: 0.35, quality: 0.20, trace: 0.20, tokenEff: 0.15, timeEff: 0.10 }

// Integration usage-strategy (the aot-arm follows these; the loop mutates them).
const S0 = [
  'aot sgt route "<goal>" — materialize the sgt route plan as premise + reasoning-per-axis + hypothesis-per-skill atoms.',
  'aot sgt advise — read the ranked next actions from graph state.',
  'aot sgt expand <the top advised hypothesis> --budget 900 — progressive disclosure of budgeted excerpts into a verification scaffold.',
  'aot sgt judge <that hypothesis> --supports (or --refutes if the disclosed excerpt is irrelevant to the goal).',
  'aot sgt trace — review the unified interleaved reasoning+traversal graph.',
  'Answer the goal grounded ONLY in the excerpt you disclosed via expand.',
]
const BACKLOG = [
  { id: 'INT1-expand-top2', hypothesis: 'Expand the TOP-2 advised hypotheses (not just top-1) before answering — more disclosure may raise grounding/correctness at a token cost.', mutate: 'In step 3, expand the top TWO advised hypotheses (two `aot sgt expand` calls); judge each in step 4; answer grounded in both.' },
  { id: 'INT2-judge-prune', hypothesis: 'Judge every expanded hypothesis and cite ONLY supported ones — verified selection should cut irrelevant context and raise trace quality.', mutate: 'After expanding, judge each hypothesis --supports/--refutes; in the final answer cite ONLY hypotheses you judged --supports; explicitly drop refuted ones.' },
  { id: 'INT3-refine-reroute', hypothesis: 'Use advise missingTokens to re-route once with a refined query before expanding — better hypotheses upstream.', mutate: 'After the first advise, if it suggests a refined query / missing tokens, run `aot sgt route "<goal + missing tokens>"` once more before expanding.' },
]

const ARM_SCHEMA = { type: 'object', required: ['answer', 'traceTokens', 'elapsedSec', 'atomCount', 'aotUsed'],
  properties: { answer: { type: 'string' }, traceTokens: { type: 'number' }, elapsedSec: { type: 'number' }, atomCount: { type: 'number' }, aotUsed: { type: 'boolean' } } }
const JUDGE_SCHEMA = { type: 'object', required: ['scores'], properties: { scores: { type: 'array', items: {
  type: 'object', required: ['label', 'correct', 'quality', 'trace'], properties: { label: { type: 'string' }, correct: { type: 'boolean' }, quality: { type: 'number' }, trace: { type: 'number' }, note: { type: 'string' } } } } } }
const PLAN_SCHEMA = { type: 'object', required: ['tasks'], properties: { tasks: { type: 'array', items: { type: 'object', required: ['id', 'goal', 'rubric'], properties: { id: { type: 'string' }, goal: { type: 'string' }, rubric: { type: 'string' } } } } } }
const SYNTH_SCHEMA = { type: 'object', required: ['keep', 'analysis'], properties: { keep: { type: 'boolean' }, analysis: { type: 'string' }, recommendation: { type: 'string' } } }

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0 }
function stdev(xs) { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)) }
function composite(s, norm) {
  const tokenEff = norm.tokMax > norm.tokMin ? (norm.tokMax - s.traceTokens) / (norm.tokMax - norm.tokMin) : 0.5
  const timeEff = norm.timeMax > norm.timeMin ? (norm.timeMax - s.elapsedSec) / (norm.timeMax - norm.timeMin) : 0.5
  return W.correct * (s.correct ? 1 : 0) + W.quality * (s.quality / 100) + W.trace * (s.trace / 100) + W.tokenEff * tokenEff + W.timeEff * timeEff
}

function aotArmPrompt(task, steps, rep) {
  const iso = `${PAD}/state-${task.id}-aot-r${rep}.json`
  const P = `SGT_BIN=${SGT} AOT_BR_AUTO=0 AOT_STATE=${iso} node ${REPO}/build/cli.js`
  return `Retrieval + recommendation task. mkdir -p ${PAD} first. Measure wall time: \`date +%s\` before and after; elapsedSec = difference.\n\n` +
    `GOAL:\n${task.goal}\n\n` +
    `ARM = aot+sgt INTERLEAVED. Drive retrieval through the aot<->sgt bridge in an ISOLATED state. Prefix EVERY aot command exactly with:\n  ${P}\n(the sgt binary is real; ${SGT} holds an 8733-skill corpus). Follow this strategy:\n${steps.map((s, i) => `  ${i + 1}. ${s.replace('<goal>', 'the GOAL above')}`).join('\n')}\n` +
    `After finishing: \`${P} export --token-count\` → traceTokens. atomCount = atoms in \`${P} list --format json\`. aotUsed = atomCount>0 (must be — you built a graph). If a bridge command errors (SGT_UNAVAILABLE), report it and set aotUsed=false.\n` +
    `Your "answer" = the recommendation grounded ONLY in what you disclosed via expand. Do NOT mention aot/sgt/your method in the answer (a blind judge reads it).`
}
function baseArmPrompt(task, rep) {
  return `Retrieval + recommendation task. Measure wall time: \`date +%s\` before and after; elapsedSec = difference.\n\n` +
    `GOAL:\n${task.goal}\n\n` +
    `ARM = RAW sgt retrieval, NO aot layer, NO reasoning graph, NO verification. Binary: ${SGT}. Do:\n` +
    `  1. ${SGT} graph search "<key terms from the goal>" --limit 5 --format json\n` +
    `  2. ${SGT} route plan "the goal" --limit 5 --format json\n` +
    `  3. ${SGT} context pack "<top slug from above>" --query "the goal" --budget 900 --format json (raw budgeted excerpts)\n` +
    `Read the raw sgt output. traceTokens = ceil(total chars of the raw sgt JSON you loaded / 4). atomCount=0, aotUsed=false.\n` +
    `Your "answer" = the recommendation grounded in what sgt returned. Do NOT mention your method (a blind judge reads it).`
}

async function runArm(task, arm, steps, phaseTitle) {
  const reps = await parallel(Array.from({ length: K }, (_, r) => () =>
    agent(arm === 'aot' ? aotArmPrompt(task, steps, r) : baseArmPrompt(task, r),
      { label: `${arm}:${task.id}:r${r}`, phase: phaseTitle, schema: ARM_SCHEMA, effort: 'high' })))
  return reps.filter(Boolean).map((x) => ({ ...x, taskId: task.id, arm }))
}

async function judgeTask(task, samples, phaseTitle) {
  const ordered = [...samples].sort((x, y) => (x.answer.length - y.answer.length) || (x.arm < y.arm ? -1 : 1))
  const labelled = ordered.map((s, i) => ({ label: `a${i}`, answer: s.answer, _ref: s }))
  const map = Object.fromEntries(labelled.map((l) => [l.label, l._ref]))
  const j = await agent(
    `Blind judge. Anonymised competing recommendations for ONE retrieval goal — you do NOT know which method produced each.\n` +
    `GOAL: ${task.goal}\n\nRUBRIC: ${task.rubric}\n\n` +
    `For EACH answer: correct (rubric full-marks = true else false), quality 0-100 (technical soundness + specificity), trace 0-100 (how auditable/grounded the stated retrieval is — does it cite concrete disclosed evidence vs assert). ANSWERS:\n${JSON.stringify(labelled.map((l) => ({ label: l.label, answer: l.answer })), null, 1)}`,
    { label: `judge:${task.id}`, phase: phaseTitle, schema: JUDGE_SCHEMA, effort: 'high' })
  const out = []
  for (const sc of (j?.scores || [])) { const ref = map[sc.label]; if (ref) out.push({ ...ref, correct: sc.correct, quality: sc.quality, trace: sc.trace }) }
  return out
}
function aggregate(scored) {
  const tok = scored.map((s) => s.traceTokens), tim = scored.map((s) => s.elapsedSec)
  const norm = { tokMin: Math.min(...tok), tokMax: Math.max(...tok), timeMin: Math.min(...tim), timeMax: Math.max(...tim) }
  return scored.map((s) => ({ ...s, composite: composite(s, norm) }))
}

phase('Plan')
await agent(`Run: mkdir -p ${PAD}`, { label: 'mkdir', phase: 'Plan' })
const plan = await agent(`Read ${TASKS} (Read tool). Return tasks[] = each line as {id, goal, rubric}.`, { label: 'planner', phase: 'Plan', schema: PLAN_SCHEMA })
if (!plan) throw new Error('planner failed')
const tasks = plan.tasks
log(`Plan: ${tasks.length} retrieval tasks; contrast = aot+sgt interleaved vs raw sgt`)

phase('Baseline A/B')
const base = {}
for (const t of tasks) {
  const [aot, raw] = await Promise.all([runArm(t, 'aot', S0, 'Baseline A/B'), runArm(t, 'baseline', S0, 'Baseline A/B')])
  base[t.id] = { aot: aot.filter((s) => s.aotUsed), baseline: raw }
}
phase('Judge')
const round0 = { round: 0, perTask: {}, frozenBaseline: {} }
let aot0 = [], base0 = []
for (const t of tasks) {
  const agg = aggregate(await judgeTask(t, [...base[t.id].aot, ...base[t.id].baseline], 'Judge'))
  const aC = agg.filter((s) => s.arm === 'aot').map((s) => s.composite)
  const bC = agg.filter((s) => s.arm === 'baseline').map((s) => s.composite)
  round0.perTask[t.id] = { aotMean: mean(aC), baseMean: mean(bC), margin: mean(aC) - mean(bC), samples: agg }
  round0.frozenBaseline[t.id] = bC; aot0.push(...aC); base0.push(...bC)
}
const m0 = mean(aot0) - mean(base0)
const noise0 = Math.sqrt((stdev(aot0) ** 2) / aot0.length + (stdev(base0) ** 2) / base0.length)
round0.overall = { aotMean: mean(aot0), baseMean: mean(base0), margin: m0, noiseFloor: noise0, clears: Math.abs(m0) > noise0 }
log(`Round 0: aot+sgt ${mean(aot0).toFixed(3)} vs raw-sgt ${mean(base0).toFixed(3)} | margin ${m0.toFixed(3)} (noise ${noise0.toFixed(3)}) ${Math.abs(m0) > noise0 ? 'CLEARS' : 'within noise'}`)

const rounds = [round0]
let curSteps = S0, curMargin = m0, noClear = 0
const recs = []
for (let r = 1; r <= MAX_ROUNDS; r++) {
  const ph = `Round ${r}`
  const h = BACKLOG[r - 1]; if (!h) break
  const trial = [...S0, `MUTATION (${h.id}): ${h.mutate}`]
  const perTask = {}; let aA = [], bA = []
  for (const t of tasks) {
    const aot = (await runArm(t, 'aot', trial, ph)).filter((s) => s.aotUsed)
    const agg = aggregate([...(await judgeTask(t, aot, ph)), ...round0.perTask[t.id].samples.filter((s) => s.arm === 'baseline')])
    const aC = agg.filter((s) => s.arm === 'aot').map((s) => s.composite)
    perTask[t.id] = { aotMean: mean(aC), margin: mean(aC) - mean(round0.frozenBaseline[t.id]) }
    aA.push(...aC); bA.push(...round0.frozenBaseline[t.id])
  }
  const margin = mean(aA) - mean(bA)
  const noise = Math.sqrt((stdev(aA) ** 2) / aA.length + (stdev(bA) ** 2) / bA.length)
  const improved = margin > curMargin + noise
  const synth = await agent(`Synthesiser for the aot<->sgt integration loop. Tested: ${JSON.stringify(h)}. New margin(aot-raw)=${margin.toFixed(4)}, prev best=${curMargin.toFixed(4)}, noise=${noise.toFixed(4)}, cleared=${improved}. Return keep(=${improved}), analysis (2 sentences), recommendation (one integration source/usage improvement implied, or empty).`,
    { label: `synth:r${r}`, phase: ph, schema: SYNTH_SCHEMA })
  if (synth?.recommendation) recs.push({ round: r, from: h.id, recommendation: synth.recommendation })
  if (improved) { curSteps = trial; curMargin = margin; noClear = 0 } else { noClear++ }
  rounds.push({ round: r, hypothesis: h.id, margin, noiseFloor: noise, kept: improved, analysis: synth?.analysis })
  log(`Round ${r} [${h.id}]: margin ${margin.toFixed(3)} vs best ${curMargin.toFixed(3)} (noise ${noise.toFixed(3)}) — ${improved ? 'KEPT' : 'discarded'}`)
  if (noClear >= 2) { log('Two rounds cleared nothing — honest stop.'); break }
}

return {
  rounds, round0: round0.overall, finalMargin: curMargin, finalSteps: curSteps, recommendations: recs,
  verdict: round0.overall.clears
    ? (m0 > 0 ? 'The aot<->sgt interleaving BEATS raw sgt retrieval (clears noise floor) — the integration adds measurable value'
      : 'raw sgt beats the aot interleaving on this suite (aot overhead unrepaid) — honest negative')
    : 'aot+sgt vs raw sgt within noise on this suite — inconclusive at this k/task-count',
}
