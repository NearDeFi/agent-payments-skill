# x402-pay

Skill for making HTTP 402 micropayments using USDC on Base and funding it from most chains. 

Before using this skill please review the [DISCLOSURES.txt](./DISCLOSURES.txt) and [NOTICE.txt](./NOTICE.txt) files.

## Recommended agent setup

This skill moves real money. Configure your agent/harness so it **asks for approval before executing commands** rather than running them automatically. Keep wallet-level spend limits in place (`--max-amount` on `awal x402 pay`, or Agentic Wallet / CDP spend policies), and **review every transaction** — confirm the price, recipient, and amount before approving. 

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