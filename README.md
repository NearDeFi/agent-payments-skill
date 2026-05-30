# x402-pay

Skill for making HTTP 402 micropayments using USDC on Base and funding it from most chains.

Before using this skill please review the [DISCLOSURES.txt](./DISCLOSURES.txt) and [NOTICE.txt](./NOTICE.txt) files.

## Recommended agent setup

This skill moves real money. Configure your agent/harness so it **asks for approval before executing commands** rather than running them automatically — in Claude Code, keep permission prompts on (do not use `bypassPermissions` for live payments). Keep wallet-level spend limits in place (`--max-amount` on `awal x402 pay`, or Agentic Wallet / CDP spend policies), and **review every transaction** — confirm the price, recipient, and amount before approving, and verify the reported tx hash afterward. Treat autonomous, unattended payments as opt-in, and gate them behind spend caps and allowlists (see [DISCLOSURES.txt](./DISCLOSURES.txt), item 8).

## Install

```bash
npx skills add NearDeFi/agent-payments-skill
```

Then install the runtime dependency inside the skill directory:

```bash
cd <skills-dir>/x402-pay
npm install
```

Where `<skills-dir>` is `.agents/skills` (universal) or `.claude/skills` (Claude Code), relative to your project root or home directory depending on whether you installed globally.

## Prerequisites (for development)

**Node.js 20+** — required for built-in `node:test`, top-level `await`, and `.mjs` support.

**viem**, **@x402/fetch**, **@x402/evm** — used by the scripts for payment signing and protocol handling. Install once before running scripts:

```bash
npm install
```

## RPC provider (optional)

`scripts/wallet.mjs balance` defaults to the public Base RPC (`https://mainnet.base.org`), which is rate-limited. For production, point it at your own provider via env vars in `.env`:

```
BASE_RPC_URL=https://your-provider.example/v2/<project>
BASE_RPC_KEY=<bearer token>   # optional
```

Or per-invocation: `node scripts/wallet.mjs balance <address> --rpc <url> [--rpc-key <key>]`.

`--rpc-key` is sent as `Authorization: Bearer <key>`. Most providers (Alchemy, Infura, QuickNode) embed the key in the URL — for those, put the full URL with the key in `BASE_RPC_URL` and omit `BASE_RPC_KEY`.

## Wallet credentials

`scripts/load-env.mjs` (imported by `pay.mjs`, `sign-x402-payment.mjs`, and `wallet.mjs`) auto-loads `.env` from two locations. Precedence, highest wins:

1. Shell-exported vars (`export X402_PRIVATE_KEY=...` before launching the agent)
2. `.env` in your **project root** (the directory you ran the agent from) — recommended
3. `.env` in the **skill directory** (`x402-pay/.env`) — fallback for skill-local credentials

Pick the wallet type you're using and add the relevant vars to your project-root `.env`:

```
# Raw private key  (works with any agent stack, no provider account needed)
# The scripts also accept PRIVATE_KEY / WALLET_PRIVATE_KEY / ETH_PRIVATE_KEY
# as fallbacks, but use X402_PRIVATE_KEY to avoid colliding with other tools.
X402_PRIVATE_KEY=<0x hex private key>

# CDP — Coinbase Developer Platform server wallet
CDP_API_KEY_ID=<key id>
CDP_API_KEY_SECRET=<key secret>
CDP_WALLET_SECRET=<wallet secret>
CDP_WALLET_ADDRESS=<0x address>

# Privy server wallet
PRIVY_APP_ID=<app id>
PRIVY_APP_SECRET=<app secret>
PRIVY_WALLET_ID=<server wallet id>
PRIVY_WALLET_ADDRESS=<0x address of that wallet>

# Turnkey
TURNKEY_API_PUBLIC_KEY=<API public key>
TURNKEY_API_PRIVATE_KEY=<API private key>
TURNKEY_ORGANIZATION_ID=<organization id>
TURNKEY_SIGN_WITH=<0x wallet address>
```

You only need the vars for whichever wallet you're using. Keep `.env` out of version control.

## Running the tests

Tests live in the `tests/` directory at the repo root (one level up). From the repo root:

```bash
npm install          # installs test dependencies
node --test tests/*.test.mjs
```

The tests are integration tests — they run the scripts as child processes and make real network requests to:
- x402-list.com (primary) and the Coinbase bazaar (`api.cdp.coinbase.com`) — for search-services tests
- The NEAR Intents API (`1click.chaindefuser.com`) — for near-intents tests
- Base mainnet RPC (`mainnet.base.org`) — for the wallet balance test

### Wallet signing tests

Three tests verify the signing flow against real wallet providers. **These tests will fail if the required env vars are not set.** Add them to a `.env` file in this directory (never commit it):

**CDP** (`tests/signing-cdp.test.mjs`) — API keys from [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com/). All three values (Key ID, Key Secret, Wallet Secret) are shown together when creating an API key — the Wallet Secret is only shown once. To get a wallet address, run `node -e "import('dotenv/config'); const {CdpClient} = await import('@coinbase/cdp-sdk'); const a = await new CdpClient().evm.createAccount(); console.log(a.address)"` once and copy the output:
```
CDP_API_KEY_ID=<your key id>
CDP_API_KEY_SECRET=<your key secret>
CDP_WALLET_SECRET=<your wallet secret>
CDP_WALLET_ADDRESS=<0x address from createAccount()>
```

**Privy** (`tests/signing-privy.test.mjs`) — app credentials and server wallet from [dashboard.privy.io](https://dashboard.privy.io/):
```
PRIVY_APP_ID=<your app id>
PRIVY_APP_SECRET=<your app secret>
PRIVY_WALLET_ID=<server wallet id>
PRIVY_WALLET_ADDRESS=<0x address of that wallet>
```

**Turnkey** (`tests/signing-turnkey.test.mjs`) — API keys and wallet from [app.turnkey.com](https://app.turnkey.com/):
```
TURNKEY_API_PUBLIC_KEY=<API public key>
TURNKEY_API_PRIVATE_KEY=<API private key>
TURNKEY_ORGANIZATION_ID=<organization id>
TURNKEY_SIGN_WITH=<0x wallet address>
```

All other tests (OWS, pay, search-services, near-intents, wallet, sign) use a well-known Hardhat/Anvil test key and require no wallet setup.

## Scripts

| Script | Commands |
|--------|----------|
| `scripts/wallet.mjs` | `address`, `balance`, `new` |
| `scripts/search-services.mjs` | `search`, `details` |
| `scripts/near-intents.mjs` | `tokens`, `quote`, `status` |
| `scripts/sign-x402-payment.mjs` | `sign`, `payload` |
| `scripts/pay.mjs` | _(single operation)_ |

Run any script without arguments to see its usage.

## Evals

Two types of evals verify the skill works correctly:

### Description evals — does the skill trigger on the right queries?

Tests whether Claude activates the skill for relevant queries and ignores it for unrelated ones. Each query is run 3 times in parallel; a query passes if at least 2/3 runs agree.

**Prerequisites:** `claude` CLI, `jq`. No wallet credentials required.

The repo includes `.claude/skills/x402-pay` as a symlink so Claude Code picks up the skill automatically when run from this directory. If you need it globally (e.g. for manual testing outside the repo), symlink it to your home skills directory:

```bash
ln -sf "$(pwd)/x402-pay" ~/.claude/skills/x402-pay
```

```bash
# Training set (12 queries)
bash evals/run-eval.sh evals/train_queries.json

# Validation set (8 queries)
bash evals/run-eval.sh evals/validation_queries.json
```

Query sets live in `evals/train_queries.json` and `evals/validation_queries.json`. The full combined set is in `evals/eval_queries.json`.

### Output quality evals — does the skill complete real payment tasks correctly?

Runs 7 end-to-end payment tasks using five wallet types (raw private key, CDP, Privy, Turnkey, Coinbase Agentic Wallet) plus service discovery and a Bitcoin price lookup. Each funded eval bridges NEAR USDC → Base via NEAR Intents before making the x402 payment.

All 7 evals run in parallel; grading is done by a second Claude call per assertion.

**Prerequisites:** `claude` CLI, `jq`, wallet credentials in `x402-pay/.env`. The `.claude/skills/x402-pay` symlink in the repo means no manual skill setup is needed.

**Environment variables** — add to `x402-pay/.env`:

```
# NEAR source account (funds the Base wallets)
NEAR_PRIVATE_KEY=<ed25519 private key for the NEAR account>

# Raw private key wallet
X402_PRIVATE_KEY=<hex private key>

# CDP wallet
CDP_API_KEY_ID=<key id>
CDP_API_KEY_SECRET=<key secret>
CDP_WALLET_ADDRESS=<0x address>
CDP_WALLET_SECRET=<wallet secret>

# Privy wallet
PRIVY_APP_ID=<app id>
PRIVY_APP_SECRET=<app secret>
PRIVY_WALLET_ID=<server wallet id>
PRIVY_WALLET_ADDRESS=<0x address>

# Turnkey wallet
TURNKEY_API_PUBLIC_KEY=<API public key>
TURNKEY_API_PRIVATE_KEY=<API private key>
TURNKEY_ORGANIZATION_ID=<organization id>
TURNKEY_SIGN_WITH=<0x wallet address>
```

The **Coinbase Agentic Wallet** eval (`pay-agentic-wallet`) uses no env vars — it authenticates via email OTP. Because that login is interactive, the eval requires a **pre-authenticated `awal` session** on the machine: run `npx awal@2.10.0 auth login <email>` once (and `auth verify`) before the eval run, and fund that wallet's Base address. Without an active session the eval will fail at the auth step.

```bash
# Run iteration 1 (results saved to evals/workspace/iteration-1/)
bash evals/run-output-eval.sh 1

# Run a second iteration
bash evals/run-output-eval.sh 2
```

Results for each eval are written to `evals/workspace/iteration-<N>/<eval-id>/output.txt` (agent output) and `grading.json` (per-assertion grades with evidence).
