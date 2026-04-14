---
name: x402
description: >
  Use this skill when the user wants to call a paid API, access an x402-protected resource,
  check the price of an endpoint, browse or search for x402 services, manage their crypto
  wallet, fund their wallet from another chain or pay for x402 services from any chain. Triggers: "x402", "HTTP 402", "pay for API",
  "paid endpoint", "find x402 services", "bazaar", "fund my wallet", "deposit", "top up",
  or a request returns a 402 response.
compatibility: Recommended — payments-mcp MCP server (npx @coinbase/payments-mcp --client claude-code --auto-config). Can also run without it using a raw private key — see references/wallet-setup.md. Requires internet access.
metadata:
  version: "1.0"
---

# x402 — HTTP-Native Payments

x402 gates API resources behind USDC micropayments using HTTP `402 Payment Required`.

> **Wallet:** If `make_http_request_with_x402` is available in your tools (payments-mcp), use the flow below. Otherwise, read `references/wallet-setup.md` before continuing — it will detect your wallet setup and explain the manual payment flow.

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

**Without payments-mcp** — query the bazaar API directly (no auth required):
```
GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources?limit=100&network=eip155:8453
```
To search: `node scripts/search-bazaar.js --url https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources <keyword>`

Each result includes a `network` field showing which chain(s) the service accepts payment on. A service may be Base-only, Solana-only, or support both. **Currently only Base (and Polygon) payments are supported by payments-mcp** — Solana payment signing is not yet implemented.

**Get full details for a specific service** (schemas, parameters, examples):
```
bazaar_get_resource_details(resource="<resource URL or name>")
```

**For a non-bazaar endpoint** (URL you already have):
```
x402_discover_payment_requirements(baseURL="<base URL>", path="<path>", method="GET")
```
Returns the price and accepted payment networks without charging anything. The response includes an `accepts` array — each entry specifies a network (e.g. `eip155:8453` for Base, `solana:...` for Solana).

### Example working service

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
- **Balance < service price** → read `references/near-intents-funding.md` for the complete cross-chain funding flow, including swap status monitoring and balance verification

**Gas:** No ETH needed — Coinbase Paymaster sponsors gas for USDC payments on Base.

---

## Step 4: Pay

**Always show the price to the user before paying. Confirm if > $0.10 USDC.**

**For bazaar resources** — get details first, then pay:
```
bazaar_get_resource_details(resource="<resource>")
make_http_request_with_x402(baseURL="<base URL>", path="<path>", method="<GET|POST>", body={...})
```

**For non-bazaar endpoints:**
```
x402_discover_payment_requirements(baseURL="<base URL>", path="<path>", method="GET")
make_http_request_with_x402(baseURL="<base URL>", path="<path>", method="<GET|POST>")
```

`make_http_request_with_x402` handles the 402 → sign → retry flow automatically.

**Note:** Solana payment signing is not yet supported by payments-mcp — only Base and Polygon payments work currently. Do not use `preferredNetwork="solana"`.

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
