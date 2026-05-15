# AGENTS.md

Loose lessons learned while using the **skill-creator** skill (at `.agents/skills/skill-creator/`). Terse on purpose. **Always read `.agents/skills/skill-creator/SKILL.md` first** — this file only supplements it.

## Subagent prompts for test runs

- Keep prompts minimal. The prescribed format (`Skill path / Task / Input files / Save outputs to`) is enough — don't add framing like "you're running an eval," "report what you did," or environment hints the agent should discover itself (e.g. that the CLI is pre-authenticated).
- Don't add restrictions like "don't run the server" or "typechecking optional." Those bias the agent away from the verification step you're trying to measure.

## Aggregation gotchas

- The aggregator expects per-run subdirectories: `eval-X/<config>/run-N/grading.json` (plus `timing.json`). If you save outputs at `eval-X/<config>/grading.json` (no `run-N`), it picks up nothing and reports 0%.
- Config ordering in `benchmark.md` is alphabetical, which means `new_skill` / `old_skill` and `with_skill` / `without_skill` flip the delta sign. Sanity-check the sign by hand.

## Capturing subagent transcripts

- Each `Agent` task writes its JSONL transcript to `/tmp/claude-*/-workspaces-*/<session>/tasks/<task_id>.output`. **Don't `cat` or `Read` it** — it's the full transcript and will blow your context.
- Do `cp` it into the run directory as `transcript.jsonl` once the task completes. The viewer also looks for `transcript.md` at the same level.

## Eval viewer

- It embeds every file under `outputs/` into a single inline `<script>`. Without an exclude list it'll happily inline 482 MB of `node_modules`, and a stray backtick inside a vendored file crashes the page. The current code excludes `node_modules`, `__pycache__`, `.venv`, `.next`, `dist`, `build`, lockfiles, etc. — extend that list if a new ecosystem shows up.
- Bind to `0.0.0.0` (not `127.0.0.1`) so devcontainer / remote setups can reach it via the forwarded port.

## When the same baseline serves multiple iterations

- For iteration N+1 of an existing skill, you don't have to re-run the previous version as `old_skill`. Just point the viewer at the prior iteration with `--previous-workspace` and only run `with_skill` for the new round.

## Eval fixtures

- Audit fixtures for things the agent will faithfully copy and amplify: stale dep versions (`typescript: ^6.0.0` doesn't exist), tool choices the user dislikes (`tsx watch` if the user prefers native Node), `import os` that's unused, etc. Fixtures are part of the test surface.
