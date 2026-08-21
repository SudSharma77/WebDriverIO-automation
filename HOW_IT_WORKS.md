# How This Works

This is a working-notes reference for what actually happens when you use Test
Lab — the pipeline, the files behind each step, and the features layered on
top of the original project. For the product pitch and quick-start, see
[README.md](README.md).

## What this is

You describe a test case in plain English, give it a URL (or app path), and
it:

1. opens a real browser/device and actually performs the scenario,
2. writes a WebdriverIO spec from what it observed,
3. proves that spec works by replaying it **cold**, in a fresh process.

A green result means "this file is reusable," not "the agent managed to
click through it once." That's the whole point of the replay step.

## The pipeline, stage by stage

Each run moves through these phases in order (`server/src/lanes/lane.ts`
drives this):

### 1. Preflight — `server/src/lanes/preflight.ts`
Fails fast on bad input: missing URL, unreachable Appium, no cloud farm
configured for iOS. Nothing expensive starts until this passes.

### 2. Site skim — `server/src/agent/siteSkim.ts`
Web lane only. A free, instant fetch of the raw page HTML before any live
interaction — title, headings, button labels, form labels — so the explorer
has a rough map before spending its step budget.

### 3. Explore — `server/src/agent/explore.ts`
A live session opens via `@wdio/mcp`. The AI drives it for real: clicks,
types, navigates, screenshots, re-reads the screen after each action. Capped
at `MAX_AGENT_STEPS` tool calls. It never uses a selector it hasn't actually
observed, and it says so plainly if the scenario is genuinely impossible
rather than faking a pass.

### 4. Structure — `server/src/agent/synthesize.ts` (`generateScaffold`)
Before any code is written, a separate LLM pass turns the exploration into a
**fixed-shape plan**:

```
Test: <title>
Target: <platform/URL>
Preconditions:
- ...
Steps:
1. ...
Expected Result:
- ...
```

Same template whether the prompt was one sentence or a paragraph — this is
what keeps output structure consistent regardless of how the model happens
to feel about a given request. The plan gets baked into the generated file
as a comment header, so it's visible in the artifact itself.

### 5. Code — `server/src/agent/synthesize.ts` (`synthesizeSpec`)
Implements the plan exactly: one `it()` step per Steps line, one real
assertion per Expected Result line. Rules enforced via the system prompt in
`server/src/agent/prompts.ts`:

- selector priority (`button=`, `aria/`, `data-testid`, then platform ids) —
  never brittle XPath/class chains
- a whitelist of real `expect-webdriverio` matchers (no invented ones)
- native `<select>` dropdowns use `selectByVisibleText`/`selectByAttribute`,
  never `click()` on an `<option>`
- credentials get `setValue(value, { mask: true })`
- suite hygiene — reset cookies/state rather than assume a clean session

### 6. Lint gate — `server/src/agent/lint.ts`
A deterministic check on top of the prompt rules: `eslint-plugin-wdio`'s
recommended rules (`wdio/await-expect`, `wdio/no-pause`, `wdio/no-debug`) run
against the generated code. A prompt rule can be silently ignored; a lint
rule can't. If it finds a real issue — most commonly a missing `await`
before `expect(...)`, which otherwise "passes" without checking anything —
one targeted corrective call fixes just that.

### 7. Verify — `server/src/runner/verify.ts`
The exploratory session is closed, and the generated file is replayed via a
real `wdio run` in a fresh process. This is the actual proof. If it fails,
an `afterTest` hook in the generated `wdio.conf.mjs` captures a screenshot
and the full page HTML into `failure-artifacts/`.

### 8. Repair — `server/src/agent/synthesize.ts` (`repairSpec`)
One attempt, only on a real replay failure. Gets the actual error output
plus the DOM snapshot from the failure moment, and fixes the implementation
while keeping the same plan (it can't quietly change what the test is
supposed to prove).

### 9. Stability check (optional) — `server/src/lanes/lane.ts` (`checkStability`)
If requested, a passed spec gets replayed N more cold times to catch
timing-dependent flakiness before you trust it.

## Features beyond the core loop

| Feature | Where |
|---|---|
| Run persistence (survives a server restart) | `server/src/persist.ts`, `server/src/store.ts` |
| Model fallback on rate-limit (synth/repair only) | `server/src/agent/llm/index.ts` |
| Repair diff view | `web/src/diff.ts`, `LaneCard.tsx` |
| Run history | `web/src/components/History.tsx` |
| Project export (.zip: spec + config + package.json + README) | `server/src/export.ts` |
| Regression re-check (replay a stored spec, zero AI calls) | `POST /api/runs/:id/:platform/reverify` in `server/src/routes/runs.ts` |
| Bulk upload (many cases, run sequentially) | `server/src/batch.ts`, `web/src/components/BatchUpload.tsx` / `BatchResults.tsx` |
| Syntax highlighting | `web/src/highlight.tsx` |
| Boolean-argument coercion (some models send `"true"` as a string) | `server/src/mcp/bridge.ts` (`coerceToolInput`) |

## Deliberately not built

Multi-scenario **single-file** generation (one spec with several `it()`
blocks scaffolded from a whole markdown plan) — different enough from the
one-scenario-per-run model that it needs its own design. Bulk upload
(above) covers "many test cases," just as separate runs rather than one
combined file.

## Configuration

See [`.env.example`](.env.example) for the full list. The load-bearing ones:

- `LLM_PROVIDER` / `LLM_MODEL` / the matching API key — which model drives
  the agent. `LLM_FALLBACK_MODEL` is tried once on a 429 during synth/repair.
- `MAX_AGENT_STEPS` — device actions per lane before the agent wraps up.
- `SEND_SCREENSHOTS_TO_MODEL` — biggest single token-cost lever on a free
  tier.

## Dev-tooling skills

`.agents/skills/` holds the [webdriverio-skills](https://github.com/klamping/webdriverio-skills)
pack — reference material for an AI coding agent working *on this repo's own
code* (writing/fixing specs by hand, diagnosing failures). It doesn't affect
what the running app does; see [`skills-lock.json`](skills-lock.json) for
what's installed.
