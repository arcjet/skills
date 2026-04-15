# Contributing to Arcjet Skills

## Overview

This repo contains [Agent Skills](https://agentskills.io/) for
[Arcjet](https://arcjet.com/). Each skill is a directory with a `SKILL.md` file
that guides AI coding agents through a specific security task.

## Structure

```
skill-name/
├── SKILL.md              # Skill instructions (required)
└── evals/
    ├── evals.json        # Test cases
    └── files/            # Input files for test cases
skill-creator/            # Anthropic's skill-creator (for building/evaluating)
```

## Creating or modifying a skill

1. **Write or edit `SKILL.md`** following the
   [Agent Skills specification](https://agentskills.io/specification).

2. **Use the original Arcjet docs as source of truth.** Run
   `Read https://docs.arcjet.com/llms.txt` as the reference for SDK APIs,
   frameworks, and configuration. Do not invent API details.

3. **Minimize adaptation from the plugin.** If porting a skill from
   [arcjet/arcjet-plugin](https://github.com/arcjet/arcjet-plugin), use the
   original content and only change what's necessary:
   - Remove plugin-specific metadata (`pathPatterns`, `importPatterns`,
     `promptSignals`)
   - Add `metadata.author: arcjet`
   - Update `/arcjet:` cross-references to standalone skill names
   - Remove `$ARGUMENTS` references

## Evaluating a skill

We use the [skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator)
workflow for eval-driven iteration. The `skill-creator/` directory is included
in this repo.

### The eval loop

1. **Design test cases** — add prompts and expected outputs to
   `evals/evals.json`. Start with 2–3 cases. Don't add expectations (assertions)
   yet.

2. **Run each test case** with and without the skill using subagents (or
   separate sessions). Save outputs to:
   ```
   skill-name-workspace/iteration-N/eval-name/with_skill/run-1/outputs/
   skill-name-workspace/iteration-N/eval-name/without_skill/run-1/outputs/
   ```

3. **Review first outputs** — look at what the skill actually produced, then
   write expectations based on what you observed. Add to `evals/evals.json` and
   `eval_metadata.json` per eval directory.

4. **Grade** — evaluate each expectation against outputs. Save to
   `run-1/grading.json` using the schema in
   `skill-creator/references/schemas.md` (fields: `text`, `passed`, `evidence`).

5. **Aggregate** — from the `skill-creator/` directory:
   ```sh
   python3 -m scripts.aggregate_benchmark ../skill-name-workspace/iteration-N --skill-name skill-name
   ```

6. **Generate viewer** — for human review:
   ```sh
   python3 skill-creator/eval-viewer/generate_review.py \
     skill-name-workspace/iteration-N \
     --skill-name "skill-name" \
     --benchmark skill-name-workspace/iteration-N/benchmark.json \
     --static skill-name-workspace/iteration-N/review.html
   ```

7. **Human review** — open the viewer, leave feedback. Save as `feedback.json`.

8. **Iterate** — improve `SKILL.md` based on failed expectations and feedback,
   then re-run in `iteration-N+1/`.

### What gets committed

- `evals/evals.json` and `evals/files/` — **committed** (test cases and inputs)
- `*-workspace/` directories — **not committed** (gitignored, eval artifacts)

## License

By contributing, you agree that your contributions will be licensed under the
[Apache License 2.0](LICENSE).
