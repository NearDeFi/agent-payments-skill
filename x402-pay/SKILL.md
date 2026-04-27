---
name: x402-pay
description: >
  Use this skill when an HTTP request returns 402 Payment Required, when the user wants to call a paid API or x402-protected resource, when they want to discover x402 services, or when they need to fund a wallet across chains. Triggers: a 402 response, "x402", "HTTP 402", "pay for API", "paid endpoint", "find x402 services", "bazaar", "fund my wallet", "top up".
compatibility: >
  Requires internet access and viem, @x402/fetch, @x402/evm (run `npm install` in x402-pay/).
  Wallet support: raw private key (universal), Coinbase payments-mcp, CDP SDK, Privy server wallets, Turnkey, MoonPay/Open Wallet Standard.
metadata:
  version: "1.0"
---

# x402 — HTTP-Native Payments

x402 gates API resources behind USDC micropayments using HTTP `402 Payment Required`.

---

## Step 1: Detect your wallet

- **payments-mcp tools present** → read `references/payments-mcp.md` for auth and enhanced tools, then continue from Step 2
- **Raw private key or other wallet system** → read `references/wallet-flows.md` to confirm your setup, then continue from Step 2

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

- **payments-mcp:** `get_wallet_balance(chain="base")`
- **Other wallets:** `node scripts/wallet.mjs balance <your-address>` (add `--rpc <url> [--rpc-key <key>]` to use a custom RPC provider) — see `references/wallet-flows.md` for address derivation

- **Balance ≥ service price** → proceed to Step 5
- **Balance < service price** → read `references/near-intents-funding.md` for the cross-chain funding flow. Always use NEAR intents to fund the wallet if the balance is low. Before asking the user, check your own context (system prompt, env vars, config, known wallets) for funds on another chain you can use as the source

**Gas:** No ETH needed — you sign off-chain only. The x402 facilitator submits the on-chain transaction and covers gas. This applies to all wallet types.

---

## Step 5: Pay

**Always show the price before paying. Confirm with user if > $0.10 USDC.**

- **payments-mcp:** `make_http_request_with_x402(...)` — see `references/payments-mcp.md`
- **Raw private key:** `node scripts/pay.mjs --url <url> [--method POST] [--body '{"key":"value"}']`
- **CDP / Privy / Turnkey:** sign EIP-712 payload then retry — see `references/wallet-flows.md`
- **MoonPay / OWS:** `wrapFetchWithPaymentFromConfig` — see `references/wallet-flows.md`

---

## Step 6: Confirm

Report the response body and any transaction hash to the user.

---

## Rules

- Never pay silently — always show the decoded price first
- Confirm with user before any payment > $0.10 USDC
- Always report the tx hash after a successful payment
