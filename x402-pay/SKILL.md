---
name: x402-pay
description: >
  Use this skill when an HTTP request returns 402 Payment Required, when the user wants to call a paid API or x402-protected resource, when they want to discover x402 services, or when they need to fund a wallet across chains. Triggers: a 402 response, "x402", "HTTP 402", "pay for API", "paid endpoint", "find x402 services", "bazaar", "fund my x402 wallet", "top up my x402 wallet".
compatibility: >
  No API keys required. Works out of the box with the default Coinbase Agentic Wallet (awal) — just an email address to log in.
  Also supports raw private key, CDP SDK, Privy, and Turnkey if already configured. Requires internet access.
metadata:
  version: "1.0.2"
  openclaw:
    homepage: https://github.com/NearDeFi/agent-payments-skill
    emoji: "💸"
    requires:
      bins: ["node", "npm"]
    # Dependencies are installed via `npm install` (SKILL.md Step 0); the bundled
    # package.json declares them. ClawHub `install` specs only fetch
    # global CLI binaries, so they don't apply here.
    envVars:
      # Raw private key wallet — provide ONE of these (X402_PRIVATE_KEY is canonical; the rest are aliases)
      - { name: X402_PRIVATE_KEY,        required: false, description: "Raw private key wallet (canonical)" }
      - { name: PRIVATE_KEY,             required: false, description: "Raw private key wallet (alias for X402_PRIVATE_KEY)" }
      - { name: WALLET_PRIVATE_KEY,      required: false, description: "Raw private key wallet (alias for X402_PRIVATE_KEY)" }
      - { name: ETH_PRIVATE_KEY,         required: false, description: "Raw private key wallet (alias for X402_PRIVATE_KEY)" }
      - { name: AGENT_PRIVATE_KEY,       required: false, description: "Raw private key wallet (alias for X402_PRIVATE_KEY)" }
      # Base RPC (optional — defaults to public Base mainnet RPC)
      - { name: BASE_RPC_URL,            required: false, description: "Custom Base RPC URL (defaults to public Base mainnet RPC)" }
      - { name: BASE_RPC_KEY,            required: false, description: "Optional Base RPC auth token (sent as Authorization: Bearer)" }
      # Coinbase CDP SDK wallet
      - { name: CDP_API_KEY_ID,          required: false, description: "Coinbase CDP SDK wallet — API key id" }
      - { name: CDP_API_KEY_SECRET,      required: false, description: "Coinbase CDP SDK wallet — API key secret" }
      - { name: CDP_WALLET_SECRET,       required: false, description: "Coinbase CDP SDK wallet — wallet secret" }
      - { name: CDP_WALLET_ADDRESS,      required: false, description: "Coinbase CDP SDK wallet — wallet address (optional)" }
      # Privy server wallet
      - { name: PRIVY_APP_ID,            required: false, description: "Privy server wallet — app id" }
      - { name: PRIVY_APP_SECRET,        required: false, description: "Privy server wallet — app secret" }
      - { name: PRIVY_WALLET_ID,         required: false, description: "Privy server wallet — wallet id" }
      - { name: PRIVY_WALLET_ADDRESS,    required: false, description: "Privy server wallet — wallet address (optional)" }
      # Turnkey wallet
      - { name: TURNKEY_API_PUBLIC_KEY,  required: false, description: "Turnkey wallet — API public key" }
      - { name: TURNKEY_API_PRIVATE_KEY, required: false, description: "Turnkey wallet — API private key" }
      - { name: TURNKEY_ORGANIZATION_ID, required: false, description: "Turnkey wallet — organization id" }
      - { name: TURNKEY_SIGN_WITH,       required: false, description: "Turnkey wallet — signing address / key handle" }
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

**No API keys required.** The default wallet (awal) works with just an email address. CDP, Privy, and Turnkey wallets are also supported if already configured.

---

## Step 1: Detect your wallet

Read `references/detecting-wallets.md` to choose which wallet to use. Once you've picked one, return here and continue from Step 2.

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

Then preview the live price — this reads the 402 challenge **without paying** and is wallet-independent:
```bash
node scripts/check-price.mjs <url> [--method GET|POST] [--body '{"key":"value"}']
```
Note this price: you'll use it in Step 4 to check whether your balance is sufficient (and, if funding, how much to deposit), and show it to the user before paying in Step 5.

### Example working service

```bash
https://x402.ottoai.services/crypto-news
```

---

## Step 4: Check Balance

Check your wallet's USDC balance on Base — see `references/wallet-flows.md` for the method for your wallet (if you don't already know it) — and compare it against the price you previewed in Step 3.

- **Balance ≥ service price** → proceed to Step 5
- **Balance < service price** → fund it: Read `references/near-intents-funding.md` for the cross-chain funding flow. Always use NEAR intents to fund the wallet if the balance is low. If the user has no crypto to swap from, the **onramp** path (`references/onramp-funding.md`) funds the wallet from Cash App / Robinhood / Revolut.

**Gas:** No ETH needed — you sign off-chain only. The x402 facilitator submits the on-chain transaction and covers gas. This applies to all wallet types.

---

## Step 5: Pay

**Always show the price before paying. Confirm with user before paying.**

Show the user the price you previewed in Step 3 (if significant time has passed, re-run `check-price.mjs` in case it changed). **Always get their confirmation before paying — for any amount.** Then pay the endpoint using your wallet — see `references/wallet-flows.md` for the method for your wallet (if not already known). Always pass the confirmed price, unpadded, as the payment command's hard cap — `--max-price <usdc>` for `pay.mjs`, `--max-amount <atomic>` for awal, `MAX_PRICE` in the managed-signer template — so a quote raised at payment time fails closed instead of overcharging.

This rule applies to **every** payment method, including wallets not covered in `references/wallet-flows.md`: if the wallet's tooling has a spend-cap option, pass the confirmed price there; otherwise plug its EIP-712 signer into the managed-signer template (it is wallet-agnostic — any wallet that can sign typed data works) so `MAX_PRICE` is enforced. Never pay through a mechanism that cannot enforce the confirmed price as a hard cap at payment time.

---

## Step 6: Confirm

Report the response body and any transaction hash to the user.

---

## Rules

- **Always ask the user before executing any command.** Show the exact command you intend to run and wait for explicit approval before running it — this applies to wallet, payment, and funding commands.
- Abide by configured safeguards such as wallet spend limits and allowlists.
- Never pay through a mechanism that cannot enforce the user-confirmed price as a hard cap at payment time — for wallets without one, route signing through the managed-signer template in `references/wallet-flows.md`.
- If a wallet's authentication is missing or expired (e.g. awal is signed out), **stop immediately and report it**, telling the user what login action to take. Never attempt to recover access yourself: do not search the user's files, email, message history, or browser/app storage for keys, session tokens, or OTP codes, and do not retry authentication repeatedly.
- When funding, always confirm the refund destination (address, chain, and origin-chain vs. NEAR Intents balance) with the user before any deposit.
- Never pay silently — always show the decoded price first
- Confirm with user before any payment
- Always report the tx hash after a successful payment
