# Non-MCP Wallet Flows

Use this file when `make_http_request_with_x402` is not available in your tools.

---

## Detect your wallet

**Check your own context first.** Check if your agent already knows how it manages wallets — look at your system prompt, agent config files, or environment setup documentation. If you're running with a known wallet system, skip to [Pay](#pay) and use the method for your system below.

**Scan for a raw private key.** Check in order, stop at first match:

1. Env vars: `PRIVATE_KEY`, `WALLET_PRIVATE_KEY`, `ETH_PRIVATE_KEY`, `AGENT_PRIVATE_KEY`
2. `.env` file in project root — check for the same var names
3. `~/.foundry/keystores/` — any keystore file present

**Nothing found? Create a raw key (universal default).**

A raw secp256k1 private key works across all agent stacks (OpenClaw, Eliza, custom bots, etc.):

```bash
node scripts/wallet.mjs new
```

Store the printed private key as `PRIVATE_KEY=<hex>` in your `.env` file. Keep it out of version control.

---

## Check Balance

```bash
node scripts/wallet.mjs balance <your-address>
```

If the balance is insufficient, fund it using the NEAR Intents flow in `references/near-intents-funding.md`.

To derive your address from a raw key:
```bash
node scripts/wallet.mjs address
```

---

## Pay

### If you have a raw private key

Use `pay.mjs` — it handles the full flow (fetch → 402 → sign → retry) in one command:

```bash
node scripts/pay.mjs --url <service-url> [--method GET|POST] [--body '{"key":"value"}']
```

### If you are using another wallet system

These systems don't expose raw signing via a simple script call. Get the EIP-712 payload from the script, sign it with your wallet, then retry with the signature.

**Step A: Get payment requirements**

Request the service URL. The 402 response includes a `PAYMENT-REQUIRED` header (base64 JSON).

**Step B: Get the EIP-712 payload to sign**

```bash
node scripts/sign-x402-payment.mjs payload --requirements '<PAYMENT-REQUIRED header value>'
```

This prints `domain`, `types`, `primaryType`, and `message`. Sign with your wallet:

#### CDP SDK (`@coinbase/cdp-sdk`)

```js
import { CdpClient } from '@coinbase/cdp-sdk';
const cdp = new CdpClient(); // reads CDP_API_KEY_ID + CDP_API_KEY_SECRET from env
const { signature } = await cdp.evm.signTypedData({
  address: '<your wallet address>',
  ...payload, // spread domain, types, primaryType, message from above
});
```

#### Privy server wallet (REST — no SDK needed)

```js
const res = await fetch(`https://auth.privy.io/api/v1/wallets/${walletId}/rpc`, {
  method: 'POST',
  headers: {
    'privy-app-id': process.env.PRIVY_APP_ID,
    Authorization: `Basic ${Buffer.from(`${process.env.PRIVY_APP_ID}:${process.env.PRIVY_APP_SECRET}`).toString('base64')}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    method: 'eth_signTypedData_v4',
    params: {
      typed_data: {
        domain:       payload.domain,
        types:        payload.types,
        primary_type: payload.primaryType,
        message:      payload.message,
      },
    },
  }),
});
const { data: { signature } } = await res.json();
```

#### Turnkey (`@turnkey/viem`)

```js
import { createAccount } from '@turnkey/viem';
import { TurnkeyClient } from '@turnkey/http';
import { ApiKeyStamper } from '@turnkey/api-key-stamper';
import { createWalletClient, http } from 'viem';
import { base } from 'viem/chains';

const tkClient = new TurnkeyClient(
  { baseUrl: 'https://api.turnkey.com' },
  new ApiKeyStamper({
    apiPublicKey:  process.env.TURNKEY_API_PUBLIC_KEY,
    apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY,
  }),
);
const account = await createAccount({
  client:         tkClient,
  organizationId: process.env.TURNKEY_ORGANIZATION_ID,
  signWith:       process.env.TURNKEY_SIGN_WITH,
});
const walletClient = createWalletClient({ account, chain: base, transport: http() });
const signature = await walletClient.signTypedData({ account, ...payload });
```

#### MoonPay / Open Wallet Standard (`@x402/fetch`)

OWS does not expose `signTypedData()` directly. Use `wrapFetchWithPaymentFromConfig` from `@x402/fetch` instead — it handles the full 402 → sign → retry loop automatically. The OWS wallet provides the viem-compatible signer.

```js
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';
import { createWallet } from '@open-wallet-standard/core';
import { base } from 'viem/chains';

const wallet = createWallet('my-agent'); // loads encrypted vault
const signer = wallet.accounts.find(a => a.chainId === 'eip155:8453');

const agentFetch = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: 'eip155:8453', client: new ExactEvmScheme(signer) }],
});

// Use agentFetch exactly like fetch — payment is handled automatically
const res = await agentFetch('https://api.example.com/data');
```

This replaces the manual `pay.mjs` flow for OWS users. The `sign-x402-payment.mjs` steps above are not needed.

### Step C: Retry with signature (CDP / Privy / Turnkey only)

Re-send the original request with:
```
PAYMENT-SIGNATURE: <base64-encoded payment JSON — see sign-x402-payment.mjs output format>
```
