# Claude Code Guidelines

## Git Workflow

**Never push to or open a PR against `main` directly.** Pushing to `main` is blocked via `deny` rules in `.claude/settings.json`. All work flows through the long-lived **`development`** branch, which is the integration branch; `main` only ever receives `development`.

### Branch model

- **`main`** — stable, eval-verified. Only the user promotes `development` → `main`, and only after the evals pass. Never target `main` with a feature PR.
- **`development`** — the integration branch. All feature work merges here first.

### Required workflow for any change

1. Branch off `development` (not `main`): `git checkout development && git pull && git checkout -b <name>`.
2. Make commits on `<name>`.
3. Run `npm run test` and make it pass before opening a PR.
4. Push: `git push -u origin <name>` (pre-approved in settings.json).
5. Open a PR from `<name>` → **`development`** for the user to review and merge. Never open a PR into `main`.

### Promoting to `main` (user-initiated only)

Do **not** open `development` → `main` PRs as part of normal work. `main` is gated on the **evals** (which cost real USDC and are slow), so promotion happens infrequently and only when the user asks. When promoting, use a regular merge (not squash) so each feature's history is preserved on `main`.

Do **not** merge or rebase into `main` directly. Do **not** force-push.

## Agent Skills — Authoring Standards

When creating or editing skills, follow the [Agent Skills spec](https://agentskills.io/specification):

**Directory layout** — supporting files must live in named subdirectories:
```
skill-name/
├── SKILL.md
├── scripts/      # executable code agents or users can run
├── references/   # additional documentation loaded on demand
└── assets/       # templates, data files, static resources
```

**Frontmatter rules:**
- `version` is not a valid top-level field — put it under `metadata.version`, in semver (`"1.0.0"`). This single location satisfies both validators: the Agent Skills spec / `skills-ref` (which **rejects** a top-level `version`) and ClawHub (which reads `metadata.version`). Never add a top-level `version`.
- Add `compatibility` if the skill requires specific tools, packages, or network access
- `name` must be lowercase, hyphens only, and match the directory name

### ClawHub publishing metadata (`metadata.openclaw`)

Skills published to [ClawHub](https://docs.openclaw.ai/clawhub/skill-format) carry a `metadata.openclaw` block. It lives under the spec-allowed arbitrary `metadata` map, so Claude/`skills-ref` ignore it — it only affects the ClawHub listing and preflight checks. **Keep it in sync with the skill's actual runtime needs:**

- **`envVars`** — must list **every** env var the scripts and `references/` read. Whenever you add, remove, or rename an env var anywhere in the skill, update this list to match. Source of truth: `grep -rohE 'process\.env\.[A-Z0-9_]+' scripts/` plus any vars documented in `references/`. Mark each `required: false` unless the skill cannot run without it.
- **`requires.env`** — stays **empty** here: every wallet backend is optional (the default Coinbase Agentic Wallet needs no env vars), so no var is universally required. Only list a var here if the skill is unusable without it.
- **`requires.bins`** — the CLI binaries the skill invokes (currently `node`, `npm`). Update if the skill starts shelling out to other tools.
- **`install`** — do **not** use it for the skill's own npm dependencies. ClawHub `install` specs only fetch **global CLI binaries** (`kind: brew|node|go|uv` + a named `package`/`formula`). Local deps are declared in `package.json` and installed via SKILL.md Step 0 (`npm install`).

After any change to this block, re-validate: `npx -y skills-ref validate ./x402-pay` (Claude side) and `clawhub sync --dry-run` (ClawHub side, before publishing).

**File references:**
- Use paths relative to the skill root (e.g. `references/foo.md`, not `skill-name/references/foo.md`)
- Always tell the agent *when* to load a reference file — e.g. "if balance is insufficient, read `references/near-intents-funding.md`" — not just that the file exists

**Size:** Keep `SKILL.md` under 500 lines. Move detailed reference material to `references/`.

**API response structures:** Do not document full response schemas in skills. The agent sees the actual response at runtime and can parse JSON without guidance. Only include:
- Specific field names the skill logic depends on (e.g. `quote.depositAddress`, `quote.minAmountIn`)
- Gotchas — non-obvious required conditions, silent failures, or surprising field behaviour

Documenting obvious fields, types, or full schemas adds tokens for no benefit and creates a maintenance burden when APIs change.

## Script conventions

Each script that performs more than one kind of operation must use a named subcommand as the first positional argument to control the top-level flow — never a flag. Flags are only used as parameters within a command.

```
node scripts/foo.mjs <command> [--flag value]   ✓
node scripts/foo.mjs --mode quote               ✗
```

Examples from the x402-pay skill: `search-services.mjs search`, `search-services.mjs details`, `near-intents.mjs tokens`, `near-intents.mjs quote`, `near-intents.mjs status`.

Single-operation scripts (e.g. `pay.mjs`) do not need a subcommand.

### Loading `.env` in scripts

Any script that reads `process.env.*` for user-supplied secrets or config must load `.env` via the shared loader, not by calling `dotenv.config()` directly. This keeps the lookup order consistent across scripts and harnesses (Claude Code, OpenClow, Cline, manual invocation).

```js
import { loadEnv } from './load-env.mjs';
loadEnv();
```

`loadEnv()` checks the project root (`process.cwd()/.env`) first, then the skill directory (`x402-pay/.env`). `dotenv` never overrides existing `process.env` vars, so the effective runtime precedence is **shell-exported > project root > skill dir**. Document the project-root location to users — the skill-dir fallback is for developers running scripts manually from inside the skill directory.

Scripts that don't read any env vars (e.g. `near-intents.mjs`, `search-services.mjs`) must not import the loader.

## Tests

Whenever the scripts are updated the tests should be updated also.

Whenever code snippets in `SKILL.md` or any `references/` file are updated, the corresponding test that exercises that snippet must be updated to match. The tests for wallet adapter signing (CDP, Privy, Turnkey) are the ground truth that the reference snippets are correct — if a snippet changes, the test changes with it.

Each test file must begin with a header comment listing its tests as a numbered list under a `Tests:` heading, so the file's coverage is scannable:

```js
// Tests:
//   1. <what the first test asserts>
//   2. <what the second test asserts>
```

Keep the list in sync with the actual `test(...)` blocks — same descriptions, same order — whenever tests are added, removed, or reordered. A file with only a single test does not need the list; a one-line description is enough.