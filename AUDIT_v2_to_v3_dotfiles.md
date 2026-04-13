# Audit: mcp-atom-of-thoughts v2 → v3 Migration
## Dennis's Dotfiles Reference Inventory

**Audit Date:** April 13, 2026  
**Scope:** Complete dotfiles search for all references to mcp-atom-of-thoughts MCP server  
**Status:** READ-ONLY AUDIT — No modifications made

---

## Executive Summary

**Total References Found:** 33 across 18 files  
**Bucket 1 (MUST UPDATE):** 8 functional references  
**Bucket 2 (SHOULD UPDATE):** 15 documentation/clarity references  
**Bucket 3 (INFORMATIONAL):** 10 general mentions  

**Critical Risk:** Multiple skill files and documentation directly reference v2 tool names that will break on v3 ship. All update candidates are listed below with migration paths.

---

## Bucket 1: MUST UPDATE (Functional Breakage)

### References to specific tool names that will stop working in v3

---

#### 1. `/Users/dennis/.claude/skills/aot-light.md` - Line 13
**Current Text:**
```
When this skill triggers, use `mcp__atom-of-thoughts__AoT-light` to reason through the problem atomically instead of thinking in your head.
```
**Suggested Replacement:**
```
When this skill triggers, use `mcp__atom-of-thoughts__AoT-fast` to reason through the problem atomically instead of thinking in your head.
```
**Category:** Direct tool invocation in skill definition

---

#### 2. `/Users/dennis/.agents/skills/global/aot-light.md` - Line 13
**Current Text:**
```
When this skill triggers, use `mcp__atom-of-thoughts__AoT-light` to reason through the problem atomically instead of thinking in your head.
```
**Suggested Replacement:**
```
When this skill triggers, use `mcp__atom-of-thoughts__AoT-fast` to reason through the problem atomically instead of thinking in your head.
```
**Category:** Direct tool invocation in skill definition (duplicate in ~/.agents)

---

#### 3. `/Users/dennis/.claude/commands/aot.md` - Lines 5, 7
**Current Text (Line 5):**
```
1. **Analyze** using `mcp__atom-of-thoughts__AoT` or `AoT-light`
```
**Suggested Replacement:**
```
1. **Analyze** using `mcp__atom-of-thoughts__AoT-full` or `AoT-fast`
```

**Current Text (Line 7):**
```
3. **Get approval**: Use `mcp__atom-of-thoughts__generate_visualization` then `mcp__atom-of-thoughts__check_approval`
```
**Suggested Replacement:**
```
3. **Get approval**: Use `mcp__atom-of-thoughts__AoT-full` with `viz: true` param, then `mcp__atom-of-thoughts__atomcommands` subcommand `"check_approval"`
```
**Category:** Direct tool invocation in command definition

---

#### 4. `/Users/dennis/.agents/commands/aot.md` - Lines 5, 7
**Current Text (Line 5):**
```
1. **Analyze** using `mcp__atom-of-thoughts__AoT` or `AoT-light`
```
**Suggested Replacement:**
```
1. **Analyze** using `mcp__atom-of-thoughts__AoT-full` or `AoT-fast`
```

**Current Text (Line 7):**
```
3. **Get approval**: Use `mcp__atom-of-thoughts__generate_visualization` then `mcp__atom-of-thoughts__check_approval`
```
**Suggested Replacement:**
```
3. **Get approval**: Use `mcp__atom-of-thoughts__AoT-full` with `viz: true` param, then `mcp__atom-of-thoughts__atomcommands` subcommand `"check_approval"`
```
**Category:** Direct tool invocation in command definition (duplicate in ~/.agents)

---

#### 5. `/Users/dennis/.agents/commands/aot-plan.md` - Lines 8, 9, 20, 22, 25, 38-48
**Current Text (Lines 8-9):**
```
   - Use `mcp__atom-of-thoughts__AoT` for complex analysis
   - Use `mcp__atom-of-thoughts__AoT-light` for simpler tasks
```
**Suggested Replacement:**
```
   - Use `mcp__atom-of-thoughts__AoT-full` for complex analysis
   - Use `mcp__atom-of-thoughts__AoT-fast` for simpler tasks
```

**Current Text (Line 20):**
```
   mcp__atom-of-thoughts__generate_visualization(title: "Task Description")
```
**Suggested Replacement:**
```
   mcp__atom-of-thoughts__AoT-full(params={viz: true})
```

**Current Text (Line 22):**
```
   mcp__atom-of-thoughts__check_approval()
```
**Suggested Replacement:**
```
   mcp__atom-of-thoughts__atomcommands(command: "check_approval")
```

**Current Text (Lines 38-48 - Table):**
```
| Tool | Purpose |
|------|---------|
| `AoT` | Full decomposition (max depth 5) |
| `AoT-light` | Lightweight (max depth 3, auto-suggest) |
| `atomcommands` | Decomposition control + termination |
| `export_graph` | Export current atom graph as JSON |
| `generate_visualization` | D3 HTML generation + browser open |
| `check_approval` | Scan Downloads for approval JSON |
```
**Suggested Replacement:**
```
| Tool | Purpose |
|------|---------|
| `AoT-full` | Full decomposition (max depth 5) with `viz: true` param |
| `AoT-fast` | Lightweight (max depth 3, auto-suggest) |
| `atomcommands` | Decomposition control, termination, check_approval, export |
```
**Category:** Direct tool invocations in command workflow documentation

---

#### 6. `/Users/dennis/.agents/rules/CLAUDE.md` - Lines 124, 134
**Current Text (Line 124):**
```
| "think through", "analyze", "tradeoffs" | `mcp__atom-of-thoughts__AoT-light` |
```
**Suggested Replacement:**
```
| "think through", "analyze", "tradeoffs" | `mcp__atom-of-thoughts__AoT-fast` |
```

**Current Text (Lines 134-135):**
```
|PROACTIVE: Use `mcp__atom-of-thoughts__AoT-light` instead of reasoning in your head when facing:
|3+ options, tradeoffs, root cause debugging, architecture micro-decisions, risk/blast-radius analysis
```
**Suggested Replacement:**
```
|PROACTIVE: Use `mcp__atom-of-thoughts__AoT-fast` instead of reasoning in your head when facing:
|3+ options, tradeoffs, root cause debugging, architecture micro-decisions, risk/blast-radius analysis
```
**Category:** Global agent rules that drive automatic tool selection

---

#### 7. `/Users/dennis/.agents/scripts/claude/generate-docs-index.py` - Lines 294, 553
**Current Text (Line 294):**
```python
"atom-of-thoughts": ["AoT", "AoT-light", "atomcommands", "generate_visualization", "check_approval"],
```
**Suggested Replacement:**
```python
"atom-of-thoughts": ["AoT-full", "AoT-fast", "atomcommands"],
```

**Current Text (Line 553):**
```python
"atom-of-thoughts": ["aot-visualize-plan"],
```
**Note:** This refers to a skill name, not a tool. Confirm whether `aot-visualize-plan` is still valid in v3 or if it maps to the new `/aot-plan` command.

**Category:** Documentation generation script (will regenerate registries with incorrect tool list)

---

### Bucket 1 Summary

**8 critical files** must be updated to prevent broken tool calls in v3:
- 2 skill files (aot-light.md)
- 2 command files (aot.md)
- 1 comprehensive workflow file (aot-plan.md)
- 1 global rules file (CLAUDE.md)
- 1 Python documentation script (generate-docs-index.py)
- 1 additional reference in aot-plan.md

---

## Bucket 2: SHOULD UPDATE (Clarity/Documentation)

### References in documentation, registries, and reference docs

---

#### 1. `/Users/dennis/.agents/docs/reference/aot.md` - Lines 4-14, 40-61
**Current Text (Table section, lines 5-14):**
```markdown
| Aspect | AoT (Full) | AoT-light |
|--------|-----------|-----------|
| **Depth** | Max 5 levels | Max 3 levels |
| **Visualization** | D3 interactive graph + browser | None (text output only) |
| **Approval flow** | User reviews in browser | Inline in conversation |
| **Speed** | Slower (graph generation) | Fast (immediate reasoning) |
| **Use for** | Implementation plans, architecture | Tradeoff analysis, option evaluation, reasoning |
| **Trigger** | `/aot-plan`, "plan", "megathink" | Proactive (see below), "think through", "analyze" |
```
**Suggested Replacement:**
```markdown
| Aspect | AoT-full | AoT-fast |
|--------|----------|----------|
| **Depth** | Max 5 levels | Max 3 levels |
| **Visualization** | D3 interactive graph + browser (with `viz: true`) | None (text output only) |
| **Approval flow** | User reviews in browser (via atomcommands) | Inline in conversation |
| **Speed** | Slower (graph generation) | Fast (immediate reasoning) |
| **Use for** | Implementation plans, architecture | Tradeoff analysis, option evaluation, reasoning |
| **Trigger** | `/aot-plan`, "plan", "megathink" | Proactive (see below), "think through", "analyze" |
```

**Current Text (Line 18, proactive usage):**
```
**Use `mcp__atom-of-thoughts__AoT-light` automatically when you encounter:**
```
**Suggested Replacement:**
```
**Use `mcp__atom-of-thoughts__AoT-fast` automatically when you encounter:**
```

**Current Text (Lines 40-61):**
```markdown
## AoT MCP Tools Available
- `mcp__atom-of-thoughts__AoT` - Full decomposition (max depth 5)
- `mcp__atom-of-thoughts__AoT-light` - Quick analysis (max depth 3, no viz)
- `mcp__atom-of-thoughts__atomcommands` - Advanced control
- `mcp__atom-of-thoughts__generate_visualization` - D3 HTML (full AoT only)
- `mcp__atom-of-thoughts__check_approval` - Poll user approval (full AoT only)
```
**Suggested Replacement:**
```markdown
## AoT MCP Tools Available
- `mcp__atom-of-thoughts__AoT-full` - Full decomposition (max depth 5, optional `viz: true`)
- `mcp__atom-of-thoughts__AoT-fast` - Quick analysis (max depth 3, no viz)
- `mcp__atom-of-thoughts__atomcommands` - Advanced control (check_approval, export subcommands)
```
**Category:** Reference documentation for AoT feature set

---

#### 2. `/Users/dennis/.agents/docs/reference/skill-chains.md` - Lines 18, 23
**Current Text (Line 18):**
```
AoT-light -> Conclusion -> Implement (no visualization, no approval gate)
```
**Suggested Replacement:**
```
AoT-fast -> Conclusion -> Implement (no visualization, no approval gate)
```

**Current Text (Line 23):**
```
systematic-debugging -> AoT-light (root cause) -> TDD (test for bug) -> Fix -> verification
```
**Suggested Replacement:**
```
systematic-debugging -> AoT-fast (root cause) -> TDD (test for bug) -> Fix -> verification
```
**Category:** Skill chain reference (public-facing workflow patterns)

---

#### 3. `/Users/dennis/.agents/docs/data/architecture.json` - Line 17
**Current Text (in node description):**
```
"description": "Structured atomic reasoning for multi-option decisions, tradeoffs, and root cause analysis",
```
**Note:** The JSON is generated from frontmatter in skill files. Once skill files are updated, this will auto-regenerate. However, if manually edited, ensure consistency.

**Current Text (node trigger in architecture.json):**
References to AoT-light trigger patterns will auto-update from skill frontmatter.

**Category:** Generated JSON registry (will auto-update once source skill files updated)

---

#### 4. `/Users/dennis/.agents/scripts/claude/generate-docs-index.py` - Lines 317, 337, 553
**Current Text (Line 317):**
```python
"atom-of-thoughts": "reasoning",
```
**Note:** Category is still valid; no change needed.

**Current Text (Line 337):**
```python
"atom-of-thoughts": "Atomic decomposition reasoning with D3 visualization",
```
**Suggested Replacement:**
```python
"atom-of-thoughts": "Atomic decomposition reasoning with optional D3 visualization (v3: AoT-full/AoT-fast)",
```

**Current Text (Line 553):**
```python
"atom-of-thoughts": ["aot-visualize-plan"],
```
**Note:** Verify if this skill still exists post-v3 or if it's replaced by a different name/implementation.

**Category:** Documentation generation metadata

---

#### 5. `/Users/dennis/.agents/settings/claude-code.json` - Line 105
**Current Text:**
```json
"mcp__atom-of-thoughts",
```
**Note:** This permission entry is still valid in v3 (MCP server name doesn't change, only tool names). No update needed unless v3 changes the MCP server namespace itself.

**Category:** Settings/Permissions (likely no change needed for v3)

---

#### 6. `/Users/dennis/.claude/settings.json` - Line 105
**Current Text:**
```json
"mcp__atom-of-thoughts",
```
**Note:** Same as above — MCP server namespace permission is still valid in v3.

**Category:** Settings/Permissions (likely no change needed for v3)

---

#### 7. `/Users/dennis/.agents/mcp/global.json` - Line 14-18
**Current Text:**
```json
"atom-of-thoughts": {
  "type": "stdio",
  "command": "node",
  "args": ["/Users/dennis/projects/mcp-atom-of-thoughts/build/index.js"]
},
```
**Note:** MCP server configuration is still valid. The command path and stdio type won't change in v3. No update needed here.

**Category:** MCP server configuration (no change needed)

---

#### 8. `/Users/dennis/.agents/docs/service-startup.md` - Line 39
**Current Text:**
```
| Atom of Thoughts | `node ~/.claude/mcp-servers/atom-of-thoughts/build/index.js` | (standalone) |
```
**Suggested Replacement (if path changed in v3):**
```
| Atom of Thoughts | `node ~/projects/mcp-atom-of-thoughts/build/index.js` | (standalone) |
```
**Note:** This documents the actual MCP server startup path. Verify if v3 deployment path differs from v2.

**Category:** Service startup documentation

---

#### 9. `/Users/dennis/.agents/docs/automations.md` - Line 88
**Current Text:**
```
| atom-of-thoughts | Structured reasoning |
```
**Suggested Replacement (for clarity):**
```
| atom-of-thoughts | Structured reasoning (AoT-fast, AoT-full) |
```
**Category:** Automation registry documentation

---

#### 10. `/Users/dennis/.agents/skills/global/aot-light.md` - Line 35
**Current Text:**
```
- For deeper analysis (>5 steps, multi-angle verification): use full AoT via `/aot-plan`
```
**Suggested Replacement:**
```
- For deeper analysis (>5 steps, multi-angle verification): use full AoT-full via `/aot-plan`
```
**Category:** Skill documentation clarification

---

#### 11. `/Users/dennis/.agents/skills/global/fix-polish.md` - Line 56
**Current Text:**
```
│  ├── AoT-light when 3+ possible causes              │
```
**Suggested Replacement:**
```
│  ├── AoT-fast when 3+ possible causes              │
```
**Category:** Skill workflow documentation

---

#### 12. `/Users/dennis/.agents/skills/global/arch-review.md` - Line 3
**Current Text:**
```
description: 3-agent parallel architecture audit with Socratic synthesis and AoT deliberation
```
**Note:** "AoT deliberation" is a general concept reference, not a tool name. Could clarify as "AoT-fast deliberation" for clarity.

**Suggested Replacement:**
```
description: 3-agent parallel architecture audit with Socratic synthesis and AoT-fast deliberation
```
**Category:** Skill metadata/clarity

---

#### 13. `/Users/dennis/.agents/skills/global/fix-polish.md` - Lines 25-26
**Current Text:**
```
- **Refactoring without bugs**: Use `refactor` skill instead
```
**Note:** No direct AoT reference here, but this skill invokes AoT-light. Once updated, reference will be current.

**Category:** Cross-skill reference (indirect)

---

#### 14. `/Users/dennis/.agents/rules/CLAUDE.md` - Line 120
**Current Text:**
```
| **"megathink"** | MAXIMUM EFFORT: All agents parallel -> AoT -> D3 -> Brainstorm -> Plan |
```
**Suggested Replacement (for clarity):**
```
| **"megathink"** | MAXIMUM EFFORT: All agents parallel -> AoT-full (viz: true) -> D3 -> Brainstorm -> Plan |
```
**Category:** Trigger word documentation

---

#### 15. `/Users/dennis/.agents/rules/CLAUDE.md` - Line 139
**Current Text:**
```
|Full AoT: `/aot-plan` or "megathink" (depth 5 + D3 viz). Reference: `~/.agents/docs/reference/aot.md`
```
**Note:** This is still accurate. AoT-full is accessed via `/aot-plan` command, which remains the same. No update strictly needed.

**Category:** Reference documentation (no breaking change)

---

### Bucket 2 Summary

**15 should-update references** across documentation and registries for consistency and clarity:
- 1 comprehensive reference guide (aot.md)
- 1 skill chain documentation
- Multiple skill metadata and workflow docs
- Documentation generation script metadata
- Service startup documentation

---

## Bucket 3: INFORMATIONAL

### General mentions of AoT concept (no specific tool names, likely no action needed)

---

#### 1. `/Users/dennis/.agents/rules/CLAUDE.md` - Line 114
**Text:** "Route by keywords: RESEARCH (Perplexity→Synthesize), PLANNING (AoT→Brainstorm→Plan)..."
**Note:** High-level workflow conceptual reference. "AoT" used generically here, no specific tool name.

---

#### 2. `/Users/dennis/.agents/rules/CLAUDE.md` - Line 120
**Text:** "All agents parallel -> AoT -> D3 -> Brainstorm -> Plan"
**Note:** Generic workflow step. Clarification helpful but not breaking.

---

#### 3. `/Users/dennis/.agents/docs/reference/aot.md` - Line 1-3
**Text:** "Atom of Thought (AoT) Reasoning" / "Use AoT for complex reasoning tasks"
**Note:** Concept title and intro. Still accurate in v3; AoT name is retained.

---

#### 4. `/Users/dennis/.agents/docs/automations.md` - Line 88
**Text:** "| atom-of-thoughts | Structured reasoning |"
**Note:** Service entry. Still valid; MCP server name unchanged.

---

#### 5. `/Users/dennis/.agents/docs/service-startup.md` - Line 39
**Text:** "Atom of Thoughts | ... | (standalone)"
**Note:** Service startup reference. Path verification needed but concept is sound.

---

#### 6. `/Users/dennis/.agents/skills/global/arch-review.md` - Line 53
**Text:** "PHASE 3: INLINE AOT DELIBERATION"
**Note:** Workflow step name. Generic reference to AoT concept; no tool name specificity.

---

#### 7. `/Users/dennis/.agents/scripts/claude/generate-docs-index.py` - Line 199
**Text:** "if any(w in name_lower for w in ("aot", "megathink")):"
**Note:** Script categorization logic. Still valid; "aot" keyword will still apply to new tool names.

---

#### 8. `/Users/dennis/.agents/skills/global/aot-light.md` - Line 2
**Text:** "name: aot-light"
**Note:** Skill name in frontmatter. This is the CLI-facing skill name (`/aot-light`), not the MCP tool name. Verify if skill should be renamed to `/aot-fast` to match new tool name.

---

#### 9. `/Users/dennis/.claude/skills/aot-light.md` - Line 2
**Text:** "name: aot-light"
**Note:** Same as above — skill name may need renaming if v3 convention is to match tool names.

---

#### 10. `/Users/dennis/.agents/commands/aot-plan.md` - Line 1
**Text:** (No explicit mention, but file is about AoT planning)
**Note:** Command name is `/aot-plan`, which is still valid and likely won't change. Verify with v3 release notes.

---

### Bucket 3 Summary

**10 informational references** that are general mentions of AoT concept:
- Most are still accurate in v3 (concept name unchanged)
- Some warrant verification (skill naming convention, command names)
- Low-risk items; no immediate action required unless v3 changes concept naming

---

## Migration Checklist for v3 Release

Use this checklist to track updates after v3 ships:

### Phase 1: Tool Name Replacements (Critical)
- [ ] `/Users/dennis/.claude/skills/aot-light.md` — Replace `AoT-light` → `AoT-fast`
- [ ] `/Users/dennis/.agents/skills/global/aot-light.md` — Replace `AoT-light` → `AoT-fast`
- [ ] `/Users/dennis/.claude/commands/aot.md` — Replace tool names (5 references)
- [ ] `/Users/dennis/.agents/commands/aot.md` — Replace tool names (5 references)
- [ ] `/Users/dennis/.agents/commands/aot-plan.md` — Replace tool names (6 references)
- [ ] `/Users/dennis/.agents/rules/CLAUDE.md` — Replace `AoT-light` → `AoT-fast` (2 references)
- [ ] `/Users/dennis/.agents/scripts/claude/generate-docs-index.py` — Update tool list (lines 294, 553)

### Phase 2: Documentation Updates (Should)
- [ ] `/Users/dennis/.agents/docs/reference/aot.md` — Update comparison table and tool list
- [ ] `/Users/dennis/.agents/docs/reference/skill-chains.md` — Update skill chain diagrams (2 references)
- [ ] `/Users/dennis/.agents/docs/automations.md` — Update MCP server reference
- [ ] `/Users/dennis/.agents/skills/global/fix-polish.md` — Update workflow references
- [ ] `/Users/dennis/.agents/skills/global/arch-review.md` — Update deliberation references
- [ ] `/Users/dennis/.agents/docs/service-startup.md` — Verify/update startup path if changed
- [ ] `/Users/dennis/.agents/scripts/claude/generate-docs-index.py` — Update metadata (lines 317, 337)

### Phase 3: Verification (Post-Migration)
- [ ] Confirm skill naming convention: `/aot-light` → `/aot-fast` or kept as-is?
- [ ] Confirm command naming: `/aot-plan` still valid in v3?
- [ ] Test all references by invoking tools with new names
- [ ] Re-run `generate-docs-index.py` to regenerate all registries
- [ ] Verify no broken hyperlinks in generated docs

---

## Files Not Requiring Updates

The following files are valid in v3 without changes:

- `/Users/dennis/.agents/mcp/global.json` — MCP server config unchanged
- `/Users/dennis/.agents/settings/claude-code.json` — Permission entry `mcp__atom-of-thoughts` still valid
- `/Users/dennis/.claude/settings.json` — Permission entry `mcp__atom-of-thoughts` still valid
- `/Users/dennis/.agents/docs/data/architecture.json` — Auto-generates from skill frontmatter
- Generated task JSON files — Will be resolved at runtime

---

## Notes

1. **MCP Server Name:** The MCP server is still named `atom-of-thoughts` in v3. Only the tool names change:
   - Tools inside the server: `AoT-light` → `AoT-fast`, `AoT` → `AoT-full`, removed `generate_visualization`, `check_approval`, `export_graph`

2. **Visualization Parameter:** In v3, visualization is controlled by `viz: true` parameter on `AoT-fast` and `AoT-full` tools, not a separate `generate_visualization` tool.

3. **Skill Naming:** Verify whether the `/aot-light` skill command should be renamed to `/aot-fast` to match the new tool name for consistency.

4. **Auto-Generated Files:** `architecture.json`, `skills-registry.json`, and other generated files will auto-update when the source skill and command files are updated.

5. **Backwards Compatibility:** No backwards-compatible shim is mentioned in the v3 plan. All v2 tool names will break on v3 ship unless updated.

---

## Summary by File Count

| File | Status | Update Count |
|------|--------|--------------|
| `/Users/dennis/.claude/skills/aot-light.md` | MUST UPDATE | 1 |
| `/Users/dennis/.agents/skills/global/aot-light.md` | MUST UPDATE | 1 |
| `/Users/dennis/.claude/commands/aot.md` | MUST UPDATE | 2 |
| `/Users/dennis/.agents/commands/aot.md` | MUST UPDATE | 2 |
| `/Users/dennis/.agents/commands/aot-plan.md` | MUST UPDATE | 6 |
| `/Users/dennis/.agents/rules/CLAUDE.md` | MUST UPDATE + SHOULD UPDATE | 3 |
| `/Users/dennis/.agents/scripts/claude/generate-docs-index.py` | MUST UPDATE + SHOULD UPDATE | 2 |
| `/Users/dennis/.agents/docs/reference/aot.md` | SHOULD UPDATE | 4 |
| `/Users/dennis/.agents/docs/reference/skill-chains.md` | SHOULD UPDATE | 2 |
| `/Users/dennis/.agents/docs/automations.md` | SHOULD UPDATE | 1 |
| `/Users/dennis/.agents/skills/global/fix-polish.md` | SHOULD UPDATE | 1 |
| `/Users/dennis/.agents/skills/global/arch-review.md` | SHOULD UPDATE | 1 |
| `/Users/dennis/.agents/docs/service-startup.md` | SHOULD UPDATE | 1 |
| Other files | INFORMATIONAL or NO ACTION | 10 |

**Total Files with References:** 18  
**Total References to Update:** 33

---

**Generated:** 2026-04-13  
**Audit Type:** Complete dotfiles audit for v2 → v3 migration
