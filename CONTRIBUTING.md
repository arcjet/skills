# Contributing to Arcjet Skills

## Overview

This repo contains [Agent Skills](https://agentskills.io/) for
[Arcjet](https://arcjet.com/). Each skill is a directory with a `SKILL.md` file
that guides AI coding agents through a specific security task.

## Structure

```
skill-name/
├── SKILL.md              # Skill instructions (required)
├── evals/
│   ├── evals.json        # Test cases
│   └── files/            # Input files for test cases
└── references/           # Optional reference docs
.agents/
└── skills/
    └── skill-creator/    # Anthropic's skill-creator (for building/evaluating)
```

## skill-creator

The `skill-creator` skill in `.agents/skills/` is vendored from
[anthropics/skills](https://github.com/anthropics/skills) at commit
[`2c7ec5e`](https://github.com/anthropics/skills/tree/2c7ec5e78b8e5d43ea02e90bb8826f6b9f147b0c/skills/skill-creator).
It lives in `.agents/skills/` so that Claude Code (and other agents that follow
the universal skills convention) can discover it automatically.

To update it, clone `anthropics/skills` at the desired commit and copy
`skills/skill-creator` into `.agents/skills/skill-creator`.

## Evaluating a skill

We use the skill-creator workflow for eval-driven iteration. See the
[evaluating skills](https://agentskills.io/skill-creation/evaluating-skills) docs
for the full process. The short version:

1. **Design test cases** — add prompts and expected outputs to
   `evals/evals.json`. Start with 2–3 cases. Don't add expectations yet.

2. **Run each test case** with and without the skill using `claude -p` for
   isolation. Save outputs to:
   ```
   skill-name-workspace/iteration-N/eval-name/with_skill/run-1/outputs/
   skill-name-workspace/iteration-N/eval-name/without_skill/run-1/outputs/
   ```

3. **Review outputs** — write expectations based on what you observed. Add to
   `evals/evals.json` and `eval_metadata.json` per eval directory.

4. **Grade** — evaluate each expectation against outputs. Save to
   `run-1/grading.json` using the schema in
   `.agents/skills/skill-creator/references/schemas.md`.

5. **Aggregate** — from the repo root:
   ```sh
   python3 -m .agents.skills.skill-creator.scripts.aggregate_benchmark \
     skill-name-workspace/iteration-N --skill-name skill-name
   ```

6. **Generate viewer** — for human review:
   ```sh
   python3 .agents/skills/skill-creator/eval-viewer/generate_review.py \
     skill-name-workspace/iteration-N \
     --skill-name "skill-name" \
     --benchmark skill-name-workspace/iteration-N/benchmark.json \
     --static skill-name-workspace/iteration-N/review.html
   ```

7. **Iterate** — improve SKILL.md based on feedback, re-run in
   `iteration-N+1/`.

### What gets committed

- `evals/evals.json` and `evals/files/` — **committed** (test cases and inputs)
- `*-workspace/` directories — **not committed** (gitignored, eval artifacts)

## License

By contributing, you agree that your contributions will be licensed under the
[Apache License 2.0](LICENSE).
