# Wallet Flows — How to Use Each Wallet

How to perform wallet actions (get address, check balance, fund, pay) for each supported wallet. To decide *which* wallet to use, see `references/detecting-wallets.md` first.

When writing one-off scripts, put them in this skill's `scripts/` directory (or `cd` into the skill dir before running) so they can resolve `@x402/fetch`, `viem`, and other deps from the skill's `node_modules`.

**Common — check any Base address's USDC balance** (works for every wallet once you know its address):

```bash
node scripts/wallet.mjs balance <your-address> [--rpc <url>] [--rpc-key <key>]
```

Defaults to the public Base RPC; `--rpc-key` is sent as `Authorization: Bearer <key>`. If the balance is insufficient, fund via `references/near-intents-funding.md` (or `npx awal fund` for the Agentic Wallet).

**Gas:** No ETH needed for any wallet — you sign off-chain only. The x402 facilitator submits the on-chain transaction and covers gas.

---

## Coinbase Agentic Wallet (awal) — default

An MPC wallet whose key is split and signs inside an AWS Nitro Enclave (TEE). There is **no private key to hold, leak, or lose** — you authenticate with an email one-time code, and Coinbase never has custody. It speaks x402 natively via the `awal` CLI. Pin the version (`awal@2.10.0`) so behaviour is stable.

**Authenticate:**

```bash
npx awal@2.10.0 auth login you@example.com   # emails a 6-digit code, returns a flowId
npx awal@2.10.0 auth verify <flowId> <otp>    # confirm
npx awal@2.10.0 status                        # shows wallet address once authed
```

The login persists as a local session on this machine until it expires; re-run `auth login` if `status` shows you are signed out.

**Recovery caveat — the wallet is tied to the email.** The email account *is* the recovery factor (there is no seed phrase). Use an email you control with strong 2FA; logging in with the same email from another machine reaches the same wallet and balance.

**Address / balance / fund:**

```bash
npx awal@2.10.0 address                       # Base address
npx awal@2.10.0 balance                       # USDC on Base
npx awal@2.10.0 fund                           # top up USDC
```

**Pay** — always run `details` first to preview the price, then pay with a `--max-amount` cap so an unexpectedly high price **fails closed**:

```bash
npx awal@2.10.0 x402 details <url>                                              # price + schema, no payment
npx awal@2.10.0 x402 pay <url> [-X <method>] [-d <json>] [-q <params>] [-h <json>] [--max-amount <atomic>]
```

| Flag | Meaning |
| --- | --- |
| `-X, --method` | HTTP method (default `GET`) |
| `-d, --data` | request body as a JSON string |
| `-q, --query` | query params as a JSON string |
| `-h, --headers` | custom headers as a JSON string |
| `--max-amount` | hard spend cap in **USDC atomic units** — `1000000` = $1.00, `100000` = $0.10, `10000` = $0.01 |

```bash
npx awal@2.10.0 x402 pay https://example.com/api/weather
npx awal@2.10.0 x402 pay https://example.com/api/sentiment -X POST -d '{"text": "I love this product"}'
npx awal@2.10.0 x402 pay https://example.com/api/data --max-amount 100000   # cap at $0.10
```

**Safety:** single-quote anything containing `$` (e.g. `-d '{"amt":"$1.00"}'`) so the shell does not expand it; validate user-supplied input before building the command (the `url` must start with `http(s)://` and contain no spaces or shell metacharacters; `--max-amount` must be a positive integer).

---

## Managed signer wallets: CDP, Privy, Turnkey

These three are the most similar — each is a managed/MPC wallet that plugs into `@x402/fetch` through a small custom `signer`. The library performs the 402 → sign → retry handshake (including v2 extensions like `offer-receipt` and `sign-in-with-x`) — you only supply a `signTypedData` function. Same shape `scripts/pay.mjs` uses for raw keys.

- **Address:** read it from the wallet's env var — `CDP_WALLET_ADDRESS`, `PRIVY_WALLET_ADDRESS`, or `TURNKEY_SIGN_WITH` — or from the SDK.
- **Balance:** use the common `node scripts/wallet.mjs balance <address>` command above.
- **Pay:** the wrapper boilerplate is identical for every wallet — only the body of `signTypedData` differs:

```js
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';

const signer = {
  address: '<your wallet address>',
  signTypedData: async ({ domain, types, primaryType, message }) => {
    // wallet-specific call — see per-wallet bodies below — returns hex signature
  },
};

const client = new x402Client();
registerExactEvmScheme(client, { signer });
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const res = await fetchWithPayment('https://api.example.com/data');
```

### CDP SDK (`@coinbase/cdp-sdk`)

Requires packages not included in this skill — install separately:
```bash
npm install @coinbase/cdp-sdk
```

```js
import { CdpClient } from '@coinbase/cdp-sdk';
const cdp = new CdpClient(); // reads CDP_API_KEY_ID + CDP_API_KEY_SECRET from env

// signer.signTypedData body:
const { signature } = await cdp.evm.signTypedData({
  address: signer.address,
  domain, types, primaryType, message,
});
return signature;
```

### Privy server wallet (REST — no SDK needed)

```js
// signer.signTypedData body:
const res = await fetch(`https://auth.privy.io/api/v1/wallets/${process.env.PRIVY_WALLET_ID}/rpc`, {
  method: 'POST',
  headers: {
    'privy-app-id': process.env.PRIVY_APP_ID,
    Authorization: `Basic ${Buffer.from(`${process.env.PRIVY_APP_ID}:${process.env.PRIVY_APP_SECRET}`).toString('base64')}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    method: 'eth_signTypedData_v4',
    params: { typed_data: { domain, types, primary_type: primaryType, message } },
  }),
});
const { data: { signature } } = await res.json();
return signature;
```

### Turnkey (`@turnkey/viem`)

Requires packages not included in this skill — install separately:
```bash
npm install @turnkey/viem @turnkey/sdk-server
```

```js
import { createAccount } from '@turnkey/viem';
import { Turnkey } from '@turnkey/sdk-server';
import { createWalletClient, http } from 'viem';
import { base } from 'viem/chains';

const turnkey = new Turnkey({
  apiBaseUrl:            'https://api.turnkey.com',
  apiPublicKey:          process.env.TURNKEY_API_PUBLIC_KEY,
  apiPrivateKey:         process.env.TURNKEY_API_PRIVATE_KEY,
  defaultOrganizationId: process.env.TURNKEY_ORGANIZATION_ID,
});
const account = await createAccount({
  client:         turnkey.apiClient(),
  organizationId: process.env.TURNKEY_ORGANIZATION_ID,
  signWith:       process.env.TURNKEY_SIGN_WITH,
});
const walletClient = createWalletClient({ account, chain: base, transport: http() });

// signer.signTypedData body:
return walletClient.signTypedData({ domain, types, primaryType, message });
```

---

## OWS (Open Wallet Standard)

Uses the same `signer` + `wrapFetchWithPayment` boilerplate as the three above, but `signTypedData` is a top-level function, not a method on the account object. Get the address from `evmAccount.address`; check balance with the common `node scripts/wallet.mjs balance <address>` command. Three OWS-specific quirks to handle inside the signer body:

1. Accounts use `eip155:1` chainId (not `eip155:8453`) — find any EVM account for the address
2. `signTypedData` requires `EIP712Domain` to be explicit in the `types` object
3. The returned signature may have no `0x` prefix — add it if missing

```js
import { getWallet, signTypedData as owsSignTypedData } from '@open-wallet-standard/core';

const wallet = getWallet('my-agent');
// OWS accounts use eip155:1 — pick any EVM account (same address across all EVM chains)
const evmAccount = wallet.accounts.find(a => a.chainId?.startsWith('eip155:'));

// signer.address: evmAccount.address
// signer.signTypedData body:
const typesWithDomain = {
  EIP712Domain: [
    { name: 'name',              type: 'string'  },
    { name: 'version',           type: 'string'  },
    { name: 'chainId',           type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ],
  ...types,
};
const { signature } = owsSignTypedData(
  'my-agent',
  'base',
  JSON.stringify(
    { domain, types: typesWithDomain, primaryType, message },
    (_, v) => typeof v === 'bigint' ? v.toString() : v,
  ),
);
return signature.startsWith('0x') ? signature : `0x${signature}`;
```

---

## Raw private key

Use this only if a private key is configured (see `references/detecting-wallets.md`). A raw secp256k1 key works across all agent stacks (OpenClaw, Eliza, custom bots, etc.).

**Create one** (only if you specifically need a self-custodied key and no wallet is configured):

```bash
node scripts/wallet.mjs new
```

Immediately write the key to `.env` in the project root — do not just display it and move on:

```
X402_PRIVATE_KEY=<hex from above>
```

Use `X402_PRIVATE_KEY` (not the generic `PRIVATE_KEY`) — the namespaced name avoids overwriting an existing `PRIVATE_KEY` the user may already have set for Foundry, Hardhat, or deployment scripts. `scripts/load-env.mjs` picks it up automatically on every script invocation. Keep `.env` out of version control. The key must be persisted so it survives session restarts.

**Address / balance:**

```bash
node scripts/wallet.mjs address                 # derive your Base address from the key
node scripts/wallet.mjs balance <your-address>  # USDC balance (common command above)
```

**Pay** — `pay.mjs` handles the full flow (fetch → 402 → sign → retry) in one command:

```bash
node scripts/pay.mjs --url <service-url> [--method GET|POST] [--body '{"key":"value"}']
```
