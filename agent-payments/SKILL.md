---
name: agent-payments
description: >
  Use this skill when the user wants to call a paid API, access an x402-protected resource,
  check the price of an endpoint, browse or search for x402 services, manage their crypto
  wallet, fund their wallet from another chain or pay for x402 services from any chain. Triggers: "x402", "HTTP 402", "pay for API",
  "paid endpoint", "find x402 services", "bazaar", "fund my wallet", "deposit", "top up",
  or a request returns a 402 response.
compatibility: >
  Requires internet access and viem (run `npm install` in agent-payments/).
  Wallet support: raw private key (universal), Coinbase payments-mcp, CDP SDK, Privy server wallets, Turnkey, MoonPay/Open Wallet Standard.
  payments-mcp optional — see references/payments-mcp.md.
metadata:
  version: "1.0"
---

# x402 — HTTP-Native Payments

x402 gates API resources behind USDC micropayments using HTTP `402 Payment Required`.

---

## Step 1: Detect your wallet

Check how your agent manages wallets:

- **payments-mcp tools present** → read `references/payments-mcp.md` for auth and enhanced tools, then continue from Step 2
- **Raw private key or other wallet system** → read `references/wallet-flows.md` to confirm your setup, then continue from Step 2

---

## Step 2: Find a Service

Applies to all wallet types including payments-mcp.

```bash
node scripts/search-bazaar.mjs search <keyword> [--all]
node scripts/search-bazaar.mjs details <resource-url>
```

Searches all services in the bazaar. Add `--all` to include services without descriptions. Use `details` to get full schemas, parameters, and examples for a specific service.

### Example working service

```bash
node scripts/pay.mjs --url https://xx402.vercel.app/weather
```

---

## Step 3: Check Balance

- **payments-mcp:** `get_wallet_balance(chain="base")`
- **Other wallets:** `node scripts/wallet.mjs balance <your-address>` — see `references/wallet-flows.md` for address derivation

- **Balance ≥ service price** → proceed to Step 4
- **Balance < service price** → read `references/near-intents-funding.md` for the cross-chain funding flow

**Gas:** No ETH needed — you sign off-chain only. The x402 facilitator submits the on-chain transaction and covers gas. This applies to all wallet types.

---

## Step 4: Pay

**Always show the price before paying. Confirm with user if > $0.10 USDC.**

- **payments-mcp:** `make_http_request_with_x402(...)` — see `references/payments-mcp.md`
- **Raw private key:** `node scripts/pay.mjs --url <url> [--method POST] [--body '{"key":"value"}']`
- **CDP / Privy / Turnkey:** sign EIP-712 payload then retry — see `references/wallet-flows.md`
- **MoonPay / OWS:** `wrapFetchWithPaymentFromConfig` — see `references/wallet-flows.md`

---

## Step 5: Confirm

Report the response body and any transaction hash to the user.

---

## Rules

- Never pay silently — always show the decoded price first
- Confirm with user before any payment > $0.10 USDC
- Always report the tx hash after a successful payment
- `send` and `trade` execute real financial transactions — always confirm recipient, asset, and amount with the user before calling
