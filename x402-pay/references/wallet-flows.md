# Self-Managed Wallet Flows

Use this file when a raw private key or another self-managed wallet (CDP SDK, Privy, Turnkey, OWS) is configured. If nothing is configured, the default is a **Coinbase Agentic Wallet** — see `references/agentic-wallet.md`.

When writing one-off scripts, put them in this skill's `scripts/` directory (or `cd` into the skill dir before running) so they can resolve `@x402/fetch`, `viem`, and other deps from the skill's `node_modules`.

---

## Detect your wallet

**Check your own context first.** Check if your agent already knows how it manages wallets — look at your system prompt, agent config files, or environment setup documentation. If you're running with a known wallet system, skip to [Pay](#pay) and use the method for your system below if listed, otherwise use your own knowledge to make payments or if that fails continue in this section.

**Scan for a raw private key.** Check in order, stop at first match (the scripts' `load-env.mjs` automatically loads 2 and 3 into `process.env` at runtime, so you can also just run a script and see if it picks up a key):

1. `process.env.X402_PRIVATE_KEY` — the canonical, skill-namespaced var. If set, use it as-is.
2. `process.env.PRIVATE_KEY` / `WALLET_PRIVATE_KEY` / `ETH_PRIVATE_KEY` / `AGENT_PRIVATE_KEY` — these belong to other tools (Foundry, Hardhat, deployment scripts). If you find one, **confirm with the user** before using it for live payments — it may control on-chain funds you shouldn't spend. If they agree, the scripts pick it up via the fallback chain.
3. `.env` in the project root (`process.cwd()/.env`) — same var names
4. `.env` in the skill directory (`x402-pay/.env`) — fallback for skill-local credentials
5. `~/.foundry/keystores/` — any keystore file present

**Nothing found? Default to a Coinbase Agentic Wallet.**

When no key or wallet is configured, the default is a Coinbase Agentic Wallet (no private key to lose, programmatic, agent-native) — see `references/agentic-wallet.md`. Only fall back to creating a raw key below if you specifically need a self-custodied secp256k1 key (e.g. an agent stack like OpenClaw, Eliza, or a custom bot that manages its own key) or the Agentic Wallet is unavailable:

```bash
node scripts/wallet.mjs new
```

After running, immediately write the key to `.env` in the project root — do not just display it and move on:

```
X402_PRIVATE_KEY=<hex from above>
```

Use `X402_PRIVATE_KEY` (not the generic `PRIVATE_KEY`) when saving a new key — the namespaced name avoids overwriting an existing `PRIVATE_KEY` the user may already have set for Foundry, Hardhat, or deployment scripts. `scripts/load-env.mjs` picks this up automatically on every script invocation. Keep `.env` out of version control (add to `.gitignore` if not already there). The key must be persisted so it survives session restarts.

---

## Check Balance

If you already know how to get your Base wallet address and check its USDC balance, do that. Otherwise use these scripts:

```bash
# Derive your Base address from a raw key
node scripts/wallet.mjs address

# Check USDC balance
node scripts/wallet.mjs balance <your-address>

# Check via a custom RPC provider
node scripts/wallet.mjs balance <your-address> --rpc <url> [--rpc-key <key>]
```

If the balance is insufficient, fund it using the NEAR Intents flow in `references/near-intents-funding.md`.

---

## Pay

### If you have a raw private key

Use `pay.mjs` — it handles the full flow (fetch → 402 → sign → retry) in one command:

```bash
node scripts/pay.mjs --url <service-url> [--method GET|POST] [--body '{"key":"value"}']
```

### If you are using CDP / Privy / Turnkey / OWS

These wallets plug into `@x402/fetch` via a small custom signer. The library performs the 402 → sign → retry handshake (including v2 extensions like `offer-receipt` and `sign-in-with-x`) — you only supply a `signTypedData` function. Same shape `scripts/pay.mjs` uses for raw keys.

The wrapper boilerplate is identical for every wallet — only the body of `signTypedData` differs:

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

#### CDP SDK (`@coinbase/cdp-sdk`)

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

#### Privy server wallet (REST — no SDK needed)

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

#### Turnkey (`@turnkey/viem`)

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

#### OWS (Open Wallet Standard)

OWS `signTypedData` is a top-level function, not a method on the account object. Three OWS-specific quirks to handle inside the signer body:

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
