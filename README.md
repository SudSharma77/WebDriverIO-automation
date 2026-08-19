# Test Lab — prompt to verified WebdriverIO spec

Describe a test case in plain English. The agent opens a real browser and real
devices, works through your scenario, writes a WebdriverIO spec from what it
actually saw, then **replays that spec in a fresh session** to prove it holds
up. Web, Android and iOS run in parallel.

The replay is the point. Plenty of tools will generate a test; this one only
calls it green when the generated file passes on its own, cold, in a separate
process — which is the same thing CI will do to it tomorrow.

---

## How it works

```
POST /api/runs
      │
      ├── web lane ─────┐
      ├── android lane ─┤   each lane owns its own `npx @wdio/mcp` process,
      └── ios lane ─────┘   because the MCP server holds ONE session at a time
                    │
      ┌─────────────┴──────────────────────────────────────────────┐
      │ ① preflight   is this lane even runnable? fail in English  │
      │ ② explore     Claude drives the real device via MCP tools  │
      │ ③ export      read wdio://session/current/code             │
      │ ④ synthesize  recorded JS → real spec with assertions      │
      │ ⑤ verify      spawn `wdio run` on it → pass/fail           │
      │               (one repair pass on failure, then stop)      │
      └────────────────────────────────────────────────────────────┘
                    │
              SSE → live UI
```

**Why explore before generating.** Asking a model to write selectors for an app
it has never seen produces confident fiction. Here the agent reads the actual
accessibility tree and element list first, so every selector in the output was
observed on a real screen. The synthesis prompt forbids introducing any selector
that does not appear in the transcript.

**Why one MCP process per lane.** `@wdio/mcp` allows a single live WebDriver
session per process. Three platforms in parallel means three processes; they
share nothing and cannot stomp on each other's session.

**Why the session closes before verify.** The exploratory session holds the
emulator or the cloud device. Replay needs it back — and on a metered farm,
closing early stops the meter while synthesis runs.

---

## Quick start

```bash
npm install
cp .env.example .env          # then add a GROQ_API_KEY (free, no card)
npm run dev                   # server on :8787, UI on :5173
```

Open http://localhost:5173.

The web lane works with nothing else installed. Android and iOS need the setup
below — if you skip it, those lanes are **skipped with an explanation**, not
failed silently.

---

## Choosing a model

Everything in the automation layer is free — `@wdio/mcp` (MIT), Appium
(Apache-2.0), chromedriver, the Android emulator. The MCP server is *hands*: it
exposes `click_element`, `get_elements`, `tap_element`. It does not decide what
to click. That decider is an LLM, and it is the only paid component.

Set `LLM_PROVIDER` to one of `anthropic | groq | openai | ollama | custom`. Only
the provider and its key are required — model, base URL and vision support all
have defaults. `GET /api/models` lists what your key can actually reach.

| Provider | Cost | Notes |
|---|---|---|
| `groq` | **Free tier**, no card | Default. OpenAI-compatible, strong tool use, text-only by default |
| `anthropic` | Pay-as-you-go | Billed **separately from any Claude subscription**. Best selector discipline. Use `claude-haiku-4-5` to keep it cheap |
| `ollama` | Free, local | Works, but small local models fall apart on 15+ tool agentic loops |
| `openai` / `custom` | Varies | Any OpenAI-compatible endpoint |

### Surviving a free tier

Agentic loops are quadratic in tokens — the whole conversation is resent every
turn — so a free tier sized for one-shot chat runs out fast. Three levers, all
in `.env`:

| Setting | Free-tier value | Effect |
|---|---|---|
| `SEND_SCREENSHOTS_TO_MODEL` | `false` | Biggest single saving. Screenshots still appear in the UI; the agent works from `get_elements` / `get_accessibility_tree` instead |
| `MAX_AGENT_STEPS` | `12`–`20` | Caps the loop before it compounds |
| `LEAN_TOOLS` | `auto` | Drops non-essential tools, shrinking the schema block sent every turn. On by default for every provider except Anthropic |

Also run **one platform at a time** — Groq's limits are per *organisation*, so
three parallel lanes compete for one bucket.

A 429 is reported to the UI as a readable message telling you which lever to
pull, not a stack trace.

### Provider differences that are handled for you

- **Images cannot attach to a `role:"tool"` message** in the OpenAI format. When
  vision is on, screenshots are emitted as a follow-up user turn instead
  ([openai-compatible.ts](server/src/agent/llm/openai-compatible.ts)).
- **No explicit prompt caching** outside Anthropic, so the system prompt and
  tool list are re-billed every turn — which is exactly why `LEAN_TOOLS`
  defaults on elsewhere.
- **Open models emit malformed tool arguments** often enough to matter. Bad JSON
  degrades to `{}` so the tool returns a real validation error the model can
  recover from, rather than throwing inside the loop.

---

### Web — no extra setup

WebdriverIO manages its own chromedriver. Supply a URL and go.

### Android — local Appium

```bash
npm run appium:drivers        # once: installs the uiautomator2 driver
npm run appium                # leave running in its own terminal
```

Then start an emulator (or plug in a device) and give the UI an **absolute path**
to a `.apk`. The server preflights the Appium URL and tells you plainly if it is
not up.

Requires `ANDROID_HOME` and a JDK — both already present on this machine.

### iOS — cloud only

> **iOS cannot run locally on Windows or Linux.** Appium's XCUITest driver
> requires macOS with Xcode. There is no workaround; this is Apple's constraint,
> not a gap in the tool.

Set a provider in `.env`:

```bash
CLOUD_PROVIDER=browserstack
BROWSERSTACK_USERNAME=...
BROWSERSTACK_ACCESS_KEY=...
```

Upload your `.ipa` to the provider and paste the returned app id (`bs://…`,
`storage:filename=…`). A local `.ipa` path is rejected at preflight — a cloud
device cannot read your disk.

Sauce Labs is supported via `CLOUD_PROVIDER=saucelabs` + `SAUCE_USERNAME` /
`SAUCE_ACCESS_KEY`. If you have a Mac on the network instead, point
`capabilities.ts` at it as an external Appium endpoint.

---

## Security

**The verify phase executes model-written JavaScript on this host.** That is
inherent to the product — verification means running the thing — but be clear
about what it implies.

What is in place:

- **Static guard before execution** (`agent/synthesize.ts`). A spec that
  references `child_process`, `fs`, `process.env`, `eval` or `process.exit` is
  rejected and never written to disk. This catches obvious cases; it is not a
  sandbox and a determined generation could evade it.
- **Scrubbed child environment.** The runner and the MCP processes get `PATH`,
  a temp dir, and the SDK vars they need. `ANTHROPIC_API_KEY` is never in a
  child's environment.
- **Hard timeout** on the replay (`VERIFY_TIMEOUT_MS`), SIGKILL on expiry.
- **Step budget** per lane (`MAX_AGENT_STEPS`), so a confused agent cannot burn
  tokens or metered device minutes indefinitely.
- **Server binds to 127.0.0.1** and takes no authentication — it is a local dev
  tool as written.

What you must add before this is anything other than a local tool:

- **Run the verify phase in a container**, one per run, with no network access
  beyond the target. This is the real mitigation and the static guard is not a
  substitute for it.
- **Authentication** on the API, and authorisation on the artifact endpoints.
- The Android app path is taken from the client and passed to Appium. Locally
  that is the user's own machine; exposed to a network it is an arbitrary-file
  read primitive and needs to become an upload instead.

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/capabilities` | What this server can run — drives the UI's disabled states |
| `POST` | `/api/runs` | Start a run. 400 with field-level `issues` on bad input |
| `GET` | `/api/runs` | Recent runs with per-platform status |
| `GET` | `/api/runs/:id` | Full snapshot |
| `GET` | `/api/runs/:id/stream` | SSE: snapshot, then replayed log, then live events |
| `POST` | `/api/runs/:id/cancel` | Abort in-flight lanes |
| `GET` | `/api/runs/:id/:platform/spec` | Download the generated spec |

The stream sends a full snapshot plus the missed event log on every connect, so
a client that joins late or reconnects converges on the same state as one that
was there from the start. No cursor tracking on the client.

Artifacts land in `server/artifacts/<runId>/<platform>/` — the spec, the
generated `wdio.conf.mjs`, ready to commit or run in CI as-is.

---

## Configuration

See `.env.example`. The ones that matter:

| Variable | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `anthropic` | `anthropic` \| `groq` \| `openai` \| `ollama` \| `custom` |
| `LLM_API_KEY` | — | Or the provider's usual name (`GROQ_API_KEY`, …) |
| `LLM_MODEL` | per provider | `GET /api/models` lists valid ids |
| `SEND_SCREENSHOTS_TO_MODEL` | `auto` | `false` is the biggest token saving |
| `LEAN_TOOLS` | `auto` | On for every provider except Anthropic |
| `MAX_AGENT_STEPS` | `40` | Device actions per lane before the agent is told to wrap up |
| `VERIFY_TIMEOUT_MS` | `300000` | Wall clock on the replay |
| `APPIUM_URL` | `http://127.0.0.1:4723` | Preflighted before the Android lane starts |
| `CLOUD_PROVIDER` | `none` | `browserstack` \| `saucelabs` \| `none` |

---

## Known limits

- **Run state is in memory.** A server restart orphans in-flight runs (their
  child processes die with it, so nothing leaks). Fine for one node; a real
  deployment needs the event log in Redis/Postgres and lanes on a queue.
- **One repair attempt.** If the generated spec fails replay twice, it is handed
  back failing with the full runner output rather than retried. Silent retries
  burn device minutes and usually mean the scenario itself is wrong.
- **Wire types are duplicated** between `server/src/types.ts` and
  `web/src/types.ts` rather than shared. Deliberate at this size — it keeps the
  web build off the server's NodeNext tsconfig. Promote to a `shared/` workspace
  if it grows.
- **No test suite for this repo itself.** The pipeline was verified end-to-end
  by hand against a live browser (explore → export → synthesize → verify, both
  the passing and failing paths). The seams worth covering first are the store
  reducer, the preflight matrix, and `renderConfig`.
- **Model quality shows up at verify.** The explore-live design exists so
  selectors come from observed reality. A weaker free model drifts toward
  inventing them anyway — and you only find out when the replay fails. That is
  the honest tradeoff of the free tier: the pipeline works, the pass rate drops.
- **Only the Anthropic path uses prompt caching.** Switching provider silently
  changes the per-run token cost by a large factor.

## Project layout

```
server/src/
  agent/       explore loop, synthesis, repair, prompts
  lanes/       per-platform plan, preflight, orchestration
  mcp/         @wdio/mcp process wrapper + MCP↔Anthropic tool bridge
  runner/      wdio.conf generation and the verify replay
  routes/      HTTP + SSE
web/src/
  components/  composer, lane cards, phase rail
  useRun.ts    event stream → run state
```
