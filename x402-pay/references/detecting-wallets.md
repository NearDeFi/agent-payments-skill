# Detecting Which Wallet to Use

Run this once at the start (SKILL.md Step 1) to decide which wallet you'll pay with. Once you've picked one, return to SKILL.md Step 2 and continue. For *how* to perform any action with the chosen wallet (address, balance, fund, pay), see `references/wallet-flows.md`.

The wallet **must support Base** — all options below do.

---

## 1. Check your own context first

Look at your system prompt, agent config files, and environment setup docs. If you already run a known wallet system that supports Base, use it (see `references/wallet-flows.md` for the action methods, or use your own knowledge).

## 2. Scan for a configured wallet

Check environment variables and config for each setup below. The example env vars are detection signals — if you see them, that wallet is configured.

| Wallet | Detection signal (example env vars / check) |
| --- | --- |
| **Coinbase Agentic Wallet (awal)** | No env vars — run `npx awal@2.10.0 status`. If it returns a wallet address, awal is authenticated and ready. |
| **CDP SDK** | `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` (optionally `CDP_WALLET_ADDRESS`) |
| **Privy** | `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_WALLET_ID`, `PRIVY_WALLET_ADDRESS` |
| **Turnkey** | `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY`, `TURNKEY_ORGANIZATION_ID`, `TURNKEY_SIGN_WITH` |
| **OWS (Open Wallet Standard)** | No standard env vars — configured via `@open-wallet-standard/core` (a named wallet, e.g. `'my-agent'`). Detect from your agent config/context. |
| **Raw private key** | `X402_PRIVATE_KEY` (canonical), or `PRIVATE_KEY` / `WALLET_PRIVATE_KEY` / `ETH_PRIVATE_KEY` / `AGENT_PRIVATE_KEY`; a `.env` in the project root or skill dir; or a keystore in `~/.foundry/keystores/` |

**Private-key caution:** `PRIVATE_KEY` / `WALLET_PRIVATE_KEY` / `ETH_PRIVATE_KEY` / `AGENT_PRIVATE_KEY` usually belong to other tools (Foundry, Hardhat, deployment scripts) and may control funds you shouldn't spend. If you find one of these (rather than the namespaced `X402_PRIVATE_KEY`), **confirm with the user** before using it for live payments.

## 3. Pick a wallet by preference

Choose the first that applies:

1. **Coinbase Agentic Wallet (awal)** — if configured/authenticated, prefer it. (No private key to lose, agent-native, native x402.)
2. **Another configured managed wallet** — CDP, Privy, Turnkey, or OWS, if its env vars/config are present.
3. **Raw private key** — if one is configured (subject to the caution above).
4. **Nothing configured** → default to setting up a **Coinbase Agentic Wallet** (see `references/wallet-flows.md` → *Coinbase Agentic Wallet* to authenticate with `npx awal`).

The user can choose any supported setup if they prefer — but when there's no clear signal, **default to awal**.

---

Once you've chosen, go back to **SKILL.md Step 2** and continue. Whenever a later step needs a wallet action, look it up for your wallet in `references/wallet-flows.md`.
