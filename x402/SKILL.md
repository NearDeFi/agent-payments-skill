---
name: x402
description: >
  Use this skill when the user wants to call a paid API, access an x402-protected resource,
  check the price of an endpoint, browse or search for x402 services, manage their crypto
  wallet, fund their wallet from another chain or pay for x402 services from any chain. Triggers: "x402", "HTTP 402", "pay for API",
  "paid endpoint", "find x402 services", "bazaar", "fund my wallet", "deposit", "top up",
  or a request returns a 402 response.
compatibility: Requires payments-mcp MCP server (npx @coinbase/payments-mcp --client claude-code --auto-config) and internet access
metadata:
  version: "1.0"
---

# x402 — HTTP-Native Payments via Coinbase payments-mcp

x402 gates API resources behind USDC micropayments using HTTP `402 Payment Required`.
All operations go through the `payments-mcp` MCP tools — no code, no installs.

---

## Step 1: Check Auth

```
check_session_status()
```

- **Signed in** → proceed
- **Not signed in** → call `show_wallet_app()` immediately, wait for user to sign in, then continue
- **No payments-mcp tools** → tell user to install (see [Setup](#setup))

---

## Step 2: Find a Service

**Browse all available x402 services:**
```
bazaar_list()
```
Results are saved to a file automatically (13k+ services exceed token limits).
To search the saved file: `node scripts/search-bazaar.js <saved-file> <keyword>`

**Get full details for a specific service** (schemas, parameters, examples):
```
bazaar_get_resource_details(resource="<resource URL or name>")
```

**For a non-bazaar endpoint** (URL you already have):
```
x402_discover_payment_requirements(url="<URL>")
```
Returns the price in USDC atomic units without charging anything.

### Example working serivce 

**Example — weather in Bali:**
```
x402_discover_payment_requirements(baseURL="https://xx402.vercel.app", path="/weather", method="GET")
make_http_request_with_x402(baseURL="https://xx402.vercel.app", path="/weather", method="GET", queryParams={"location": "Bali"})
```

---

## Step 3: Check Balance 

```
get_wallet_balance(chain="base")
```

USDC uses 6 decimals — divide by 1,000,000 for USD. Default chain: Base mainnet (`eip155:8453`).

- **Balance ≥ service price** → proceed to Step 4
- **Balance < service price** → read `references/near-intents-funding.md` for the complete cross-chain funding flow

**Gas:** No ETH needed — Coinbase Paymaster sponsors gas for USDC payments on Base.

---

## Step 4: Pay

**Always show the price to the user before paying. Confirm if > $0.10 USDC.**

**For bazaar resources** — get details first, then pay:
```
bazaar_get_resource_details(resource="<resource>")
make_http_request_with_x402(url="<url>", method="<GET|POST>", body={...})
```

**For non-bazaar endpoints:**
```
x402_discover_payment_requirements(url="<URL>")
make_http_request_with_x402(url="<url>", method="<GET|POST>")
```

`make_http_request_with_x402` handles the 402 → sign → retry flow automatically.
Use `preferredNetwork="solana"` to pay via Solana instead of EVM.

---

## Step 5: Confirm

Report the transaction hash and response body to the user.

---

## Rules

- Never pay silently — always show the decoded price first
- Confirm with user before any payment > $0.10 USDC
- Always report the tx hash after a successful payment
- `send` and `trade` execute real financial transactions — always confirm recipient, asset, and amount with the user before calling

---

## Common Wallet Utilities

| Task | Tool call |
|------|-----------|
| Check USDC balance | `get_wallet_balance()` |
| Check balance on one chain | `get_wallet_balance(chain="base")` |
| Get wallet address | `get_wallet_address()` |
| Get address for one chain | `get_wallet_address(chain="base")` |
| Send tokens to an address | `send(to="0x... or name.eth", amount="1.00", asset="usdc", chain="base")` |
| Swap tokens | `trade(fromAsset="usdc", toAsset="eth", amount="10.00", chain="base")` |
| Open wallet UI | `show_wallet_app()` |

**Supported chains:** `base`, `base-sepolia`, `polygon`, `solana`, `solana-devnet`
**Supported assets (Base):** `usdc`, `eth`, `weth`
**Supported assets (Polygon):** `usdc`, `pol`, `wmatic`

---

## Setup

*Only needed if `payments-mcp` tools are not available.*

**Install:**
```bash
npx @coinbase/payments-mcp --client claude-code --auto-config
```

Restart Claude Code, then sign in:

```
show_wallet_app()
```

Or sign in via email OTP:
```
sign_in_with_email(email="you@example.com")
# User receives 6-digit code → then:
verify_email_otp(flowId="<flowId from above>", otp="<6-digit code>")
```

After signing in, deposit Base USDC via the wallet UI to fund payments.
