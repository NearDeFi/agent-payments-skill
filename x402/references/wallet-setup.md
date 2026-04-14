# Wallet Setup for x402 Payments (without payments-mcp)

Use this file when `make_http_request_with_x402` is not available in your tools.

---

## Step 1: Detect your wallet

**Check your own context first.** Before scanning env vars, check if your agent already knows how it manages wallets — look at your system prompt, agent config files, or environment setup documentation. If you're running with a known wallet system (CDP AgentKit, Privy, Turnkey, or similar), skip to [Making Payments](#making-x402-payments) and use your wallet's `eth_signTypedData_v4` with the payload described there.

**Scan for a raw private key.** Check in order, stop at first match:

1. Env vars: `PRIVATE_KEY`, `WALLET_PRIVATE_KEY`, `ETH_PRIVATE_KEY`, `AGENT_PRIVATE_KEY`
2. `.env` file in project root — check for the same var names
3. `~/.foundry/keystores/` — any keystore file present

**Nothing found? Create a raw key (universal default).**

A raw secp256k1 private key works across all agent stacks (OpenClaw, Eliza, custom bots, etc.):

```bash
# Option A — Foundry (if installed)
cast wallet new

# Option B — Node (no install needed)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Store the output as `PRIVATE_KEY=<hex>` in your `.env` file. Keep this file out of version control.

---

## Step 2: Check balance

```bash
cast balance <your-address> --erc20 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913 --rpc-url https://mainnet.base.org
```

Divide the result by 1,000,000 for USD (USDC has 6 decimals). If the balance is insufficient, fund it using the NEAR Intents flow in `references/near-intents-funding.md`.

To derive your address from a raw key:
```bash
cast wallet address --private-key $PRIVATE_KEY
```

---

## Making x402 Payments

### Step A: Get payment requirements

Make a normal HTTP request to the service URL. A 402 response includes a `PAYMENT-REQUIRED` header containing base64-encoded JSON with: `accepts[]` entries each having `amount`, `payTo`, `asset`, `network`, `scheme`, `maxTimeoutSeconds`.

### Step B: Sign the EIP-712 payload

x402 on EVM uses EIP-3009 `transferWithAuthorization`. If you have a raw hex private key, use the helper script:

```bash
node scripts/sign-x402-payment.mjs --requirements '<X-PAYMENT-REQUIRED header value>' --key $PRIVATE_KEY
```

Add `--print-payload` to see the raw EIP-712 JSON — useful if you're signing with another system:

```bash
node scripts/sign-x402-payment.mjs --print-payload --requirements '<header value>' --key $PRIVATE_KEY
```

**For any other wallet system** (CDP AgentKit, Privy, Turnkey, etc.): sign the EIP-712 payload printed above using your wallet's `eth_signTypedData_v4` method. The exact API call depends on your system — pass the `domain`, `types`, and `message` fields from the payload.

### Step C: Retry with signature

Re-send the original request with the header:

```
PAYMENT-SIGNATURE: <base64 output from the signing step>
```
