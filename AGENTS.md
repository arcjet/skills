# AGENTS.md

Instructions for agents working in this repo.

## Repo structure

```
skills/
├── .agents/skills/skill-creator/   # The skill-creator skill (Anthropic upstream)
├── protect-route/                  # Arcjet protect-route skill
│   ├── SKILL.md                    # The skill itself
│   └── evals/
│       ├── evals.json              # Test prompts + expected outputs
│       └── files/                  # Fixture input files for evals
├── add-ai-protection/              # Arcjet AI endpoint protection skill
│   ├── SKILL.md
│   └── evals/
│       ├── evals.json
│       └── files/
├── *-workspace/                    # Eval artifacts (gitignored)
└── .gitignore
```

## Running skill evals

### How to run evals

Use `claude -p` for each eval run. Do NOT use subagents — they can see workspace files and leak skill context into baseline runs.

For each eval, run two `claude -p` invocations in isolated temp directories:

**With-skill run:**
1. Create a tmpdir, copy fixture files in
2. Prepend the SKILL.md content to the prompt
3. Run `claude -p "<prompt>" --output-format json --max-turns 5 --dangerously-skip-permissions` in the tmpdir
4. Copy outputs to `<workspace>/iteration-N/eval-<name>/with_skill/outputs/`

**Without-skill run:**
1. Create a separate tmpdir, copy same fixture files in
2. Run `claude -p "<prompt>" --output-format json --max-turns 5 --dangerously-skip-permissions` (no skill content)
3. Copy outputs to `<workspace>/iteration-N/eval-<name>/without_skill/outputs/`

The tmpdir isolation ensures the baseline can't see SKILL.md or other Arcjet files.

### Workspace structure

The skill-creator expects this exact layout — do NOT add extra nesting (e.g. no `run-1/`):

```
<skill>-workspace/iteration-N/
  eval-<name>/
    eval_metadata.json          # prompt + assertions
    with_skill/
      outputs/                  # Files the agent produced
      grading.json              # Assertion results
      timing.json               # Token/time data
    without_skill/
      outputs/
      grading.json
      timing.json
```

### Launching the viewer

Use `generate_review.py` in **server mode** (not `--static`) so the feedback POST endpoint works:

```bash
nohup python3 .agents/skills/skill-creator/eval-viewer/generate_review.py \
  <workspace>/iteration-N \
  --skill-name "<name>" \
  --benchmark <workspace>/iteration-N/benchmark.json \
  --port 8080 \
  > /dev/null 2>&1 &
```

Do NOT serve the static HTML with `python3 -m http.server` — the feedback submit button will silently fail (the simple server returns 405 on POST, but the JS `.then()` still fires, so it looks like it worked).

### Aggregating benchmarks

```bash
PYTHONPATH=.agents/skills/skill-creator python3 -m scripts.aggregate_benchmark \
  <workspace>/iteration-N --skill-name <name>
```

### generate_review.py fixes applied

The upstream `generate_review.py` has a bug: `iterdir()` on line ~125 only lists direct children of `outputs/`, missing files in subdirectories like `src/index.ts`. We patched it to use `rglob("*")` instead. If the upstream is updated, check whether this fix was incorporated.
