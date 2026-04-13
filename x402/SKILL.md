---
name: x402
version: "3.0"
description: >
  Use this skill when the user wants to call a paid API, access an x402-protected resource,
  check the price of an endpoint, browse or search for x402 services, or manage their crypto
  wallet. Triggers: "x402", "HTTP 402", "pay for API", "paid endpoint", "find x402 services",
  "bazaar", or a request returns a 402 response.
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

## Step 2: Find a Service (if needed)

**Browse all available x402 services:**
```
bazaar_list()
```
Returns: name, description, price, network, quality score for each service.

**Get full details for a specific service** (schemas, parameters, examples):
```
bazaar_get_resource_details(resource="<resource URL or name>")
```

**For a non-bazaar endpoint** (URL you already have):
```
x402_discover_payment_requirements(url="<URL>")
```
Returns the price in USDC atomic units (divide by 1,000,000 for USD) without charging anything.

---

## Step 3: Pay

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

## Step 4: Confirm

Report the transaction hash and response body to the user.

---

## Rules

- Never pay silently — always show the decoded price first
- Confirm with user before any payment > $0.10 USDC
- On failure, report the error and stop — do not retry without user confirmation
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

## Searching the Bazaar

`bazaar_list()` returns 13k+ services and exceeds token limits — the result is saved to a file automatically. Use this Node.js snippet to search it:

```js
// Run with: node search-bazaar.js <keyword>
import { readFileSync } from 'fs';

const [,, ...terms] = process.argv;
const keyword = terms.join(' ').toLowerCase();

const raw = JSON.parse(readFileSync(process.argv[2] || 'bazaar.json', 'utf8'));
const items = JSON.parse(raw[0].text).items;

const showAll = process.argv.includes('--all');

const results = items
  .filter(s => showAll || s.description)
  .filter(s => {
    const haystack = (s.description || '') + s.resource;
    return !keyword || haystack.toLowerCase().includes(keyword);
  })
  .map(s => ({ usd: s.maxAmountRequired / 1e6, ...s }))
  .filter(s => s.usd > 0)
  .sort((a, b) => a.usd - b.usd);

for (const s of results.slice(0, 20)) {
  console.log(`$${s.usd.toFixed(4)} | ${s.resource}`);
  if (s.description) console.log(`  ${s.description.slice(0, 100)}`);
}
```

Pass the saved file path as the first argument and the keyword as the second:
```
node search-bazaar.js /path/to/bazaar-result.json weather
```

The file path appears in the tool result when `bazaar_list()` exceeds token limits.

---

## Known Good Services

Verified working services from the bazaar:

| Service | URL | Price | Notes |
|---------|-----|-------|-------|
| Current weather (any city) | `https://xx402.vercel.app/weather?location=<city>` | $0.001 | GET, returns temp + conditions |

**Example:**
```
x402_discover_payment_requirements(baseURL="https://xx402.vercel.app", path="/weather", method="GET")
make_http_request_with_x402(baseURL="https://xx402.vercel.app", path="/weather", method="GET", queryParams={"location": "Bali"})
```

---

## Quick Reference

| | |
|--|--|
| Price header (server → you) | `PAYMENT-REQUIRED` (base64 JSON) |
| Payment header (you → server) | `PAYMENT-SIGNATURE` (base64 JSON) |
| Receipt header (server → you) | `PAYMENT-RESPONSE` (base64 JSON) |
| USDC decimals | 6 — divide `amount` by `1,000,000` for USD |
| Default chain | Base mainnet — `eip155:8453` |

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
