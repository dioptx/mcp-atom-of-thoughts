# A/B self-improving loop for aot

Does driving an agent's reasoning through `aot` measurably beat freeform reasoning?
This harness answers it empirically and then **recursively improves the way aot is used**
until no further gain clears the noise floor.

Architecture = Loop Engineering 2.0 (six layers, "the loop never stops"):

| Layer | Here |
|-------|------|
| **Planner** | reads `loop-memory.json`, picks the task subset + one strategy-improvement hypothesis from `backlog[]` |
| **Builder** | assembles the concrete aot-arm protocol for this round from `currentStrategy` |
| **Evaluator** | runs the A/B: `baseline` (freeform) vs `aot` (protocol-driven), **k replicates each, in parallel** |
| **Memory** | `loop-memory.json` — strategy, backlog, fixed weights, full `results[]` history |
| **Scheduler** | ranks the remaining backlog by expected leverage for the next round |
| **Optimiser** | keeps a strategy change **only if margin improves AND clears the noise floor**; else discards. Never mutates aot source — source ideas go to `recommendations[]` |

## Fitness function

For each task, both arms solve it; a **blind** judge (arm labels hidden, answers shuffled)
scores quality + trace, and an **objective** check (numeric tolerance / exact assignment)
scores correctness. Composite ∈ [0,1] with **fixed** weights (`scoring.weights`).

`margin = mean(aot_composite) − mean(baseline_composite)`, with pooled stdev = noise floor.

## Validity guards (why the numbers mean something)

- **Replication** (k≥3): a single sample per arm is noise; margin must exceed pooled stdev.
- **Objective anchor**: 2 of 3 tasks have machine-checkable answers — not circular LLM self-preference (External-Reference-Ratchet).
- **Blind judging**: the judge never learns which answer came from which arm.
- **Real-graph verification**: an aot-arm sample whose `aot export` has no atoms is **void** (the agent must actually use aot, not claim to).
- **Isolated state**: every sample runs in its own `--state <tmp>` file; the user's `~/.local/state/aot-cli/state.json` is never touched.
- **Honest null**: if no backlog hypothesis clears the noise floor, the loop logs it and stops — it does not manufacture a win.
- **Fixed weights**: the loop optimises the *strategy*, never the scoring, so it can't game its own metric.

## Run

```
node <scratchpad>/ab-loop.workflow.js   # via the Workflow tool (ultracode)
```

Round 0 establishes the baseline A/B and commits it; rounds 1..N run the loop.
Results append to `results/` and to `loop-memory.json`.
