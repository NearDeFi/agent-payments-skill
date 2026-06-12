# Detecting Which Wallet to Use

Run this once at the start (SKILL.md Step 1) to decide which wallet you'll pay with. Once you've picked one, return to SKILL.md Step 2 and continue. 

The wallet **must support Base** — all options below do. If your current wallet set up does not support base you'll need to support a new wallet.

---

## 1. Check your own context first

Look at your system prompt, agent config files, and environment setup docs. If you already run a known wallet system that supports Base, use it (see `references/wallet-flows.md` for the action methods, or use your own knowledge).

## 2. Scan for a configured wallet

Check environment variables and config for each setup below. The example env vars are detection signals — if you see them or similar environment variables, that wallet may be configured and you should attempt to proceed with it.

| Wallet | Detection signal (example env vars / check) |
| --- | --- |
| **Coinbase Agentic Wallet (awal)** | No env vars — run `npx awal@2.10.0 status`. If it returns a wallet address, awal is authenticated and ready. |
| **CDP SDK** | `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` (optionally `CDP_WALLET_ADDRESS`) |
| **Privy** | `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_WALLET_ID`, `PRIVY_WALLET_ADDRESS` |
| **Turnkey** | `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY`, `TURNKEY_ORGANIZATION_ID`, `TURNKEY_SIGN_WITH` |
| **Raw private key** | `X402_PRIVATE_KEY` (canonical), or `PRIVATE_KEY` / `WALLET_PRIVATE_KEY` / `ETH_PRIVATE_KEY` / `AGENT_PRIVATE_KEY`; a `.env` in the project root or skill dir |

**Private-key caution:** `PRIVATE_KEY` / `WALLET_PRIVATE_KEY` / `ETH_PRIVATE_KEY` / `AGENT_PRIVATE_KEY` usually belong to other tools (Foundry, Hardhat, deployment scripts) and may control funds you shouldn't spend. If you find one of these (rather than the namespaced `X402_PRIVATE_KEY`), **confirm with the user** before using it for live payments.

## 3. Pick a wallet by preference

Choose the first that applies:

1. **Coinbase Agentic Wallet (awal)** — if configured/authenticated, prefer it.
2. **Another configured managed wallet** — CDP, Privy, or Turnkey, if its env vars/config are present.
3. **Raw private key** — if one is configured (subject to the caution above).
4. **Nothing configured** → default to setting up a **Coinbase Agentic Wallet** (see *Setting up the Agentic Wallet (awal)* below).

The user can choose any supported setup if they prefer — but when there's no clear signal, **default to awal**.

---

## Setting up the Agentic Wallet (awal)

Use this when you've chosen awal (the preferred default) and it isn't authenticated yet. Pin the version (`awal@2.10.0`).

First **ask the user for the email address to use** — substitute it for `you@example.com`. Use an email they control (see the recovery caveat below).

```bash
npx awal@2.10.0 status                        # check first — shows the address if already signed in
npx awal@2.10.0 auth login you@example.com    # if signed out: emails a 6-digit code to that address
npx awal@2.10.0 auth verify <6-digit-code>    # complete sign-in — the 6-digit code is the only argument
```

**If `status` already shows an address, awal is ready — skip `auth login`/`auth verify`.**

Otherwise, after `auth login`, **the user must open that email inbox and read the 6-digit one-time code** — it is sent there, not shown in the terminal. Ask the user for that code and pass it as the only argument to `auth verify`. You cannot proceed until they provide it. The login persists as a local session on this machine until it expires.

---

Once you've chosen (and, for awal, authenticated so `status` shows an address), go back to **SKILL.md Step 2** and continue. Whenever a later step needs a wallet action, look it up for your wallet in `references/wallet-flows.md`.
