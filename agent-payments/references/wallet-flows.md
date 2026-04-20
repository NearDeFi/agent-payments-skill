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

After running, immediately write the key to `.env` in the project root — do not just display it and move on:

```
PRIVATE_KEY=<hex from above>
```

Keep `.env` out of version control (add to `.gitignore` if not already there). The key must be persisted so it survives session restarts.

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

Request the service URL. The 402 response will contain requirements in one of two places
depending on the server's x402 version:

- **v1** (newer): requirements are in the JSON response body
- **v2** (older): requirements are in the `payment-required` response header (base64 JSON)

Base64-encode whichever one contains the `accepts` array:

```bash
# v1 — body contains the JSON
REQUIREMENTS=$(curl -s <service-url> | base64)

# v2 — header contains the base64 JSON (already encoded, pass through as-is)
REQUIREMENTS=$(curl -sI <service-url> | awk '/^[Pp]ayment-[Rr]equired:/{print $2}' | tr -d '\r\n')
```

**Step B: Get the EIP-712 payload to sign**

```bash
node scripts/sign-x402-payment.mjs payload --requirements "$REQUIREMENTS"
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

Requires packages not included in this skill — install separately:
```bash
npm install @turnkey/viem @turnkey/http @turnkey/api-key-stamper
```

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

OWS does not expose `signTypedData()` directly. Use `wrapFetchWithPaymentFromConfig` from `@x402/fetch` instead — it handles the full 402 → sign → retry loop automatically.

Two OWS quirks require a signer wrapper:
1. `signTypedData` requires `EIP712Domain` to be explicit in the `types` object
2. The returned signature has no `0x` prefix — must be added manually

```js
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { createWallet } from '@open-wallet-standard/core';

const wallet = createWallet('my-agent'); // loads encrypted vault
const owsAccount = wallet.accounts.find(a => a.chainId === 'eip155:8453');

// Wrapper to handle OWS quirks
const signer = {
  ...owsAccount,
  signTypedData: async ({ domain, types, primaryType, message }) => {
    const typesWithDomain = {
      EIP712Domain: [
        { name: 'name',              type: 'string'  },
        { name: 'version',           type: 'string'  },
        { name: 'chainId',           type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      ...types,
    };
    const sig = await owsAccount.signTypedData({ domain, types: typesWithDomain, primaryType, message });
    return sig.startsWith('0x') ? sig : `0x${sig}`;
  },
};

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
