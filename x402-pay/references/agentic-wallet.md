# Coinbase Agentic Wallet (default)

This is the **default wallet** for the skill — use it when no private key or other wallet is configured (see [Detect your wallet](wallet-flows.md#detect-your-wallet)).

A Coinbase Agentic Wallet is an MPC wallet whose key is split and signs inside an AWS Nitro Enclave (TEE). There is **no private key to hold, leak, or lose** — you authenticate with an email one-time code, and Coinbase never has custody of the funds. It speaks x402 natively and runs through the `awal` CLI.

Pin the version (`awal@2.10.0`) so behaviour is stable.

---

## Authenticate

```bash
npx awal@2.10.0 auth login you@example.com   # emails a 6-digit code, returns a flowId
npx awal@2.10.0 auth verify <flowId> <otp>    # confirm
npx awal@2.10.0 status                        # shows wallet address once authed
```

The login persists as a local session on this machine until it expires; re-run `auth login` if `status` shows you are signed out. Coinbase does not document an exact session TTL.

**Recovery caveat — the wallet is tied to the email.** The email account *is* the recovery factor (there is no seed phrase). Use an email you control with strong 2FA. Logging in with the same email from another machine reaches the same wallet and balance; a throwaway or shared inbox puts the funds at risk.

---

## Check balance / fund

```bash
npx awal@2.10.0 balance                       # USDC on Base
npx awal@2.10.0 fund                           # top up USDC
```

If you prefer cross-chain funding from an existing balance, use the flow in `references/near-intents-funding.md` instead.

---

## Pay an x402 endpoint

Always run `details` first to see the price, show it to the user, and confirm if it is over $0.10 (skill rule). Then pay with a `--max-amount` cap so an unexpectedly high price **fails closed** instead of overspending.

```bash
# 1. Inspect price + schema (no payment, auto-detects the method)
npx awal@2.10.0 x402 details <url>

# 2. Pay
npx awal@2.10.0 x402 pay <url> [-X <method>] [-d <json>] [-q <params>] [-h <json>] [--max-amount <atomic>]
```

| Flag | Meaning |
| --- | --- |
| `-X, --method` | HTTP method (default `GET`) |
| `-d, --data` | request body as a JSON string |
| `-q, --query` | query params as a JSON string |
| `-h, --headers` | custom headers as a JSON string |
| `--max-amount` | hard spend cap in **USDC atomic units** — `1000000` = $1.00, `100000` = $0.10, `10000` = $0.01 |

Examples:

```bash
npx awal@2.10.0 x402 pay https://example.com/api/weather
npx awal@2.10.0 x402 pay https://example.com/api/sentiment -X POST -d '{"text": "I love this product"}'
npx awal@2.10.0 x402 pay https://example.com/api/data --max-amount 100000   # cap at $0.10
```

**Safety:**
- Single-quote anything containing `$` (e.g. `-d '{"amt":"$1.00"}'`) so the shell does not expand it.
- Validate user-supplied input before building the command: the `url` must start with `http(s)://` and contain no spaces or shell metacharacters (`;`, `|`, backticks); `--max-amount` must be a positive integer. Do not pass unvalidated input into the command.

---

## Service discovery

Discovery is wallet-independent — use the skill's `scripts/search-services.mjs` (Step 2a). The Agentic Wallet also ships its own bazaar search if you prefer it:

```bash
npx awal@2.10.0 x402 bazaar search "<query>" [-k <n>] [--network base] [--max-price 0.01]
npx awal@2.10.0 x402 bazaar list --full
```
