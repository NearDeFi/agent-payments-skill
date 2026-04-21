# Claude Code Guidelines

## Git Workflow

**Never push directly to `main` or `master`.** This is enforced via `deny` rules in `.claude/settings.json` — the push command will be blocked at the tool level.

### Branch naming

Always work on a branch prefixed with `claude/`. Examples:

- `claude/improvements`
- `claude/fix-auth`
- `claude/add-feature-x`

### Required workflow

1. Check the current branch — if already on `main`, create and switch to a `claude/` branch before making any changes.
2. Make commits on that branch.
3. Push the branch: `git push -u origin claude/<name>` (pre-approved in settings.json).
4. Open a PR from `claude/<name>` → `main` for the user to review and merge.

Do **not** attempt to merge or rebase into `main` directly. Do **not** force-push.

## Version

Always keep the version of the agent-payments skill at 0.1 (`metadata.version` in SKILL.md frontmatter).

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
- `version` is not a valid top-level field — put it under `metadata.version`
- Add `compatibility` if the skill requires specific tools, packages, or network access
- `name` must be lowercase, hyphens only, and match the directory name

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

Examples from the agent-payments skill: `search-services.mjs search`, `search-services.mjs details`, `intents-quote.mjs quote`, `intents-quote.mjs status`, `sign-x402-payment.mjs sign`, `sign-x402-payment.mjs payload`.

Single-operation scripts (e.g. `pay.mjs`) do not need a subcommand.

## Tests

Whenever the scripts are updated the tests should be updated also.

Whenever code snippets in `SKILL.md` or any `references/` file are updated, the corresponding test that exercises that snippet must be updated to match. The tests for wallet adapter signing (CDP, Privy, Turnkey, OWS) are the ground truth that the reference snippets are correct — if a snippet changes, the test changes with it.