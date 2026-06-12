# Wallet Flows — How to Use Each Wallet

How to perform wallet actions (get address, check balance, fund, pay) for each supported wallet. To decide *which* wallet to use, see `references/detecting-wallets.md` first.

When writing one-off scripts, put them in this skill's `scripts/` directory (or `cd` into the skill dir before running) so they can resolve `@x402/fetch`, `viem`, and other deps from the skill's `node_modules`.

**Common — check any Base address's USDC balance** (works for every wallet once you know its address):

```bash
node scripts/wallet.mjs balance <your-address> [--rpc <url>] [--rpc-key <key>]
```

Defaults to the public Base RPC; `--rpc-key` is sent as `Authorization: Bearer <key>`. If the balance is insufficient, fund via `references/near-intents-funding.md`.

**Gas:** No ETH needed for any wallet — you sign off-chain only. The x402 facilitator submits the on-chain transaction and covers gas.

---

## Coinbase Agentic Wallet (awal)

Set up / authenticate first — see `references/detecting-wallets.md` (*Setting up the Agentic Wallet*). The commands below assume `npx awal@2.10.0 status` already shows an address.

**Address / balance:**

```bash
npx awal@2.10.0 address --chain base          # Base (EVM) address (address returns EVM + Solana by default)
npx awal@2.10.0 balance --chain base          # USDC on Base
```

**Pay** — pay with a `--max-amount` cap so an unexpectedly high price **fails closed**. Note: `--chain` is **only** valid on `address`/`balance`; `x402 pay` does not accept it (payments settle on Base) — passing `--chain` errors with `unknown option '--chain'`.

```bash
npx awal@2.10.0 x402 pay <url> [-X <method>] [-d <json>] [-q <params>] [-h <json>] [--max-amount <atomic>]
```

| Flag | Meaning |
| --- | --- |
| `-X, --method` | HTTP method (default `GET`) |
| `-d, --data` | request body as a JSON string |
| `-q, --query` | query params as a JSON string |
| `-h, --headers` | custom headers as a JSON string |
| `--max-amount` | hard spend cap in **USDC atomic units** — `1000000` = $1.00, `100000` = $0.10, `10000` = $0.01 |

**Safety:** single-quote anything containing `$` (e.g. `-d '{"amt":"$1.00"}'`) so the shell does not expand it; validate user-supplied input before building the command (the `url` must start with `http(s)://` and contain no spaces or shell metacharacters; `--max-amount` must be a positive integer).

---

## Managed signer wallets: CDP, Privy, Turnkey

These three are the most similar — each is a managed/MPC wallet that plugs into `@x402/fetch` through a small custom `signer`. The library performs the 402 → sign → retry handshake (including v2 extensions like `offer-receipt` and `sign-in-with-x`) — you only supply a `signTypedData` function. Same shape `scripts/pay.mjs` uses for raw keys.

- **Address:** read it from the wallet's env var — `CDP_WALLET_ADDRESS`, `PRIVY_WALLET_ADDRESS`, or `TURNKEY_SIGN_WITH` — or from the SDK.
- **Balance:** use the common `node scripts/wallet.mjs balance <address>` command above.
- **Pay:** there's no prebuilt CLI for these wallets — write a short one-off Node script (save it under `scripts/`, run it with `node`). The block below is the **template** for that script: it makes the paid request to the endpoint. It is identical for all three wallets — **fill in three things** to make it runnable: your wallet `address`, the `signTypedData` body for your wallet (per-wallet bodies follow), and `MAX_PRICE` — the exact price the user confirmed, unpadded. `wrapFetchWithPayment` wraps `fetch` so that when the endpoint returns 402, it signs the payment authorization with your `signer` and retries automatically; `res` is the final paid response.

```js
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { parseUsdcToAtomic, optionAmount, isVerifiableBaseUsdcOption, baseUsdcOptions } from './x402-options.mjs';

const MAX_PRICE = '<user-confirmed price in USDC, e.g. 0.0100>';
const maxAtomic = parseUsdcToAtomic(MAX_PRICE);
if (maxAtomic === null) throw new Error(`Invalid MAX_PRICE: ${MAX_PRICE}`);

const signer = {
  address: '<your wallet address>',
  signTypedData: async ({ domain, types, primaryType, message }) => {
    // wallet-specific call — see per-wallet bodies below — returns hex signature
  },
};

// The server quotes a fresh price at payment time, which may differ from the one
// previewed with check-price.mjs. Pin the client to the cheapest Base USDC option
// within MAX_PRICE — the library's default takes the first option the server lists,
// on ANY EVM chain, in any asset — and fail closed when nothing qualifies.
const client = new x402Client((_version, accepts) => {
  const ok = baseUsdcOptions(accepts).filter(o => BigInt(optionAmount(o)) <= maxAtomic);
  if (!ok[0]) throw new Error(`Payment rejected: no Base USDC option within ${MAX_PRICE} USDC.`);
  return ok[0];
});
registerExactEvmScheme(client, { signer, networks: ['eip155:8453'] }); // Base mainnet only — no eip155:* wildcard
// Last line of defence: re-verify whatever was selected right before signing.
client.onBeforePaymentCreation(({ selectedRequirements: sel }) => {
  if (!isVerifiableBaseUsdcOption(sel) || BigInt(optionAmount(sel)) > maxAtomic) {
    return { abort: true, reason: `selected option is not Base USDC within ${MAX_PRICE} USDC` };
  }
});
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const res = await fetchWithPayment('https://api.example.com/data');
console.log(await res.text());   // the paid response body
```

Set `MAX_PRICE` to the price the user confirmed — never pad it for headroom. If the script fails with `Payment rejected`, the server is now quoting more than the user agreed to: re-run `check-price.mjs`, show the user the new price, and only retry with an updated `MAX_PRICE` after they re-confirm.

**Any other wallet:** the template is not limited to CDP/Privy/Turnkey — any wallet that can produce an EIP-712 typed-data signature plugs in as the `signTypedData` body. If the user pays with a wallet not covered in this file, use this template (rather than an ad-hoc payment flow) so the `MAX_PRICE` guard still applies; never pay through a mechanism that cannot enforce the confirmed price.

### CDP SDK (`@coinbase/cdp-sdk`)

Requires packages not included in this skill — install separately:
```bash
npm install @coinbase/cdp-sdk
```

```js
import { CdpClient } from '@coinbase/cdp-sdk';
const cdp = new CdpClient(); // reads CDP_API_KEY_ID + CDP_API_KEY_SECRET + CDP_WALLET_SECRET from env

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
  // @x402/fetch passes uint256 fields (value, validAfter, validBefore) as BigInt;
  // JSON.stringify throws on BigInt, so stringify them via a replacer.
  body: JSON.stringify(
    {
      method: 'eth_signTypedData_v4',
      params: { typed_data: { domain, types, primary_type: primaryType, message } },
    },
    (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
  ),
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

## Raw private key

Use this only if a raw secp256k1 private key is configured (see `references/detecting-wallets.md`).

**Create one** (only if you specifically need a self-custodied key and no wallet is configured):

```bash
node scripts/wallet.mjs new
```

**Security warning:** A raw private key in `.env` is stored in plaintext. Anyone with access to this file or machine can drain the wallet. Use a dedicated low-balance wallet, never commit `.env` to version control, exclude it from backups, and prefer a managed wallet (awal, CDP, Privy, or Turnkey) if larger amounts are involved.

Immediately write the key to `.env` in the project root so it is persisted — do not just display it and move on:

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
node scripts/pay.mjs --url <service-url> --max-price <usdc> [--method GET|POST] [--body '{"key":"value"}']
```
