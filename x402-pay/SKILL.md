---
name: x402-pay
description: >
  Use this skill when a HTTP request returns 402 Payment Required, when the user wants to call a paid API or x402-protected resource, when they want to discover x402 services, or when they need to fund a wallet across chains. Triggers: a 402 response, "x402", "HTTP 402", "pay for API", "paid endpoint", "find x402 services", "bazaar", "fund my wallet", "top up".
compatibility: >
  Requires internet access and `npm install` in x402-pay/. Wallet support: Coinbase Agentic Wallet
  (awal, default), raw private key, CDP SDK, Privy server wallets, Turnkey.
metadata:
  version: "1.0"
---

# x402 — HTTP-Native Payments

x402 gates API resources behind USDC micropayments using HTTP `402 Payment Required`.

---

## Step 0: Setup

Before running any script, install dependencies in the skill directory (once per environment):

```bash
cd <skills-dir>/x402-pay
npm install
```

---

## Step 1: Detect your wallet

Read `references/detecting-wallets.md` to choose which wallet to use — it scans your context and environment and, with no clear signal, defaults to a Coinbase Agentic Wallet. Once you've picked one, return here and continue from Step 2. For *how* to perform any wallet action (address, balance, fund, pay), see `references/wallet-flows.md`.

---

## Step 2: Is the Service Known?

If you already have a specific service URL in mind that returned 402 payment required, skip straight to `Step 3: Get the Service Details`.

Otherwise continue to `Step 2a: Find a Service`

## Step 2a: Find a Service

List all available services from x402-list and pick the most appropriate one:
```bash
node scripts/search-services.mjs search
```

If nothing suitable is found, try the Coinbase bazaar:
```bash
node scripts/search-services.mjs search <keyword> --source bazaar
```

If still nothing, search the internet for x402 services matching the user's need.

## Step 3: Get the Service Details 

Once you have a service URL, get its full details (schemas, parameters, examples):
```bash
node scripts/search-services.mjs details <resource-url>
```

### Example working service

```bash
https://x402.ottoai.services/crypto-news
```

---

## Step 4: Check Balance

Check your wallet's USDC balance on Base — see `references/wallet-flows.md` for the method for your wallet (if you don't already know it).

- **Balance ≥ service price** → proceed to Step 5
- **Balance < service price** → fund it: Read `references/near-intents-funding.md` for the cross-chain funding flow. Always use NEAR intents to fund the wallet if the balance is low. Before asking the user, check your own context (system prompt, env vars, config, known wallets) for funds on another chain you can use as the source

**Gas:** No ETH needed — you sign off-chain only. The x402 facilitator submits the on-chain transaction and covers gas. This applies to all wallet types.

---

## Step 5: Pay

**Always show the price before paying. Confirm with user before paying.**

First preview the live price. 

```bash
node scripts/check-price.mjs <url> [--method GET|POST] [--body '{"key":"value"}']
```

Show the decoded price to the user and **always get their confirmation before paying — for any amount**. Then pay the endpoint using your wallet — see `references/wallet-flows.md` for the method for your wallet (if not already known).

---

## Step 6: Confirm

Report the response body and any transaction hash to the user.

---

## Rules

- **Always ask the user before executing any command.** Show the exact command you intend to run and wait for explicit approval before running it — this applies to wallet, payment, and funding commands.
- Abide by configured safeguards such as wallet spend limits and allowlists.
- Never pay silently — always show the decoded price first
- Confirm with user before any payment
- Always report the tx hash after a successful payment
