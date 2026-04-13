---
name: x402
version: "3.1"
description: >
  Use this skill when the user wants to call a paid API, access an x402-protected resource,
  check the price of an endpoint, browse or search for x402 services, manage their crypto
  wallet, or fund their wallet from another chain. Triggers: "x402", "HTTP 402", "pay for API",
  "paid endpoint", "find x402 services", "bazaar", "fund my wallet", "deposit", "top up",
  or a request returns a 402 response.
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

## Funding Your Wallet from Another Chain (NEAR Intents)

Swap any supported asset on any chain into USDC on Base using the NEAR Intents 1-click API.
**API base:** `https://1click.chaindefuser.com`

### Step 1: Gather inputs

```
get_wallet_address(chain="base")
```

Ask the user:
- How much USDC do you want on Base?
- What asset and chain are you sending from? (e.g. ETH on Ethereum, SOL on Solana)
- What is your sending wallet address? (used as refund address — if unknown, Base wallet is used)

### Step 2: Look up asset IDs

```
GET https://1click.chaindefuser.com/v0/tokens
```

Find both:
- `destinationAsset`: USDC on `base`
- `originAsset`: the user's chosen symbol + blockchain

**Never construct asset IDs manually — always look them up from this endpoint.**

### Step 3: Dry quote (preview, no charge)

Use `EXACT_OUTPUT` — user wants a specific USDC amount, the input is variable.
Convert the desired USDC amount to atomic units (multiply by 10^decimals).

```json
POST https://1click.chaindefuser.com/v0/quote
{
  "dry": true,
  "swapType": "EXACT_OUTPUT",
  "originAsset": "<originAssetId>",
  "destinationAsset": "<usdcBaseAssetId>",
  "amount": "<desiredUsdcInAtomicUnits>",
  "recipient": "<baseWalletAddress>",
  "refundTo": "<see refund logic below>",
  "depositType": "ORIGIN_CHAIN",
  "recipientType": "DESTINATION_CHAIN",
  "refundType": "ORIGIN_CHAIN",
  "deadline": "<ISO8601 timestamp ~10 min from now>",
  "slippageTolerance": 100
}
```

**Note:** `depositType`, `recipientType`, `refundType`, and `deadline` are all required — the API returns 400 without them.

Show the user:
- Must send: `quote.minAmountIn` – `quote.maxAmountIn` of origin asset (`amountInFormatted` for display)
- Will receive: `quote.amountOutFormatted` USDC on Base
- Deadline: `quote.deadline`

### Step 4: Committed quote (get deposit address)

Once user confirms, repeat with `dry: false` to get the real deposit address (valid ~10 min):

```json
{ "dry": false, ...same fields, with a fresh deadline... }
```

Return to the user:
- **Send**: `quote.amountInFormatted` of origin asset
- **To address**: `quote.depositAddress`
- **Chain**: origin chain name
- **Asset contract**: origin token `contractAddress` (from tokens response)
- **By**: `quote.deadline`
- If `quote.depositMemo` is non-null — user must include it in the transaction (required for Stellar, otherwise funds are lost)

### Refund address logic

| Situation | What to set |
|-----------|-------------|
| User provides their origin wallet address | `refundTo`: that address |
| Origin is EVM, address unknown | `refundTo`: Base wallet address |
| Origin is non-EVM, address unknown | `refundType`: `"VIRTUAL_CHAIN"`, `virtualChainRefundRecipient`: Base wallet address — omit `refundTo` |

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
