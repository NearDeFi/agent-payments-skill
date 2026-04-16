# x402

Skill for making HTTP 402 micropayments using USDC on Base and funding it from most chains.

## Prerequisites

**Node.js 20+** — required for built-in `node:test`, top-level `await`, and `.mjs` support.

**viem** — used by the scripts for EIP-712 signing and key derivation. Install once before running scripts or tests:

```bash
npm install
```

No other dependencies. The scripts use Node's built-in `https`, `crypto`, and `http` modules for everything else.

## Running the tests

```bash
node --test tests/*.test.mjs
```

The tests are integration tests — they run the scripts as child processes and make real network requests to:
- The x402 bazaar API (`api.cdp.coinbase.com`) — for search-bazaar tests
- The NEAR Intents API (`1click.chaindefuser.com`) — for intents-quote tests
- Base mainnet RPC (`mainnet.base.org`) — for the wallet balance test

### Wallet signing tests

Three tests verify the signing flow against real wallet providers. **These tests will fail if the required env vars are not set.** Add them to a `.env` file in this directory (never commit it):

**CDP** (`tests/signing-cdp.test.mjs`) — API keys from [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com/). All three values (Key ID, Key Secret, Wallet Secret) are shown together when creating an API key — the Wallet Secret is only shown once. To get a wallet address, run `node -e "import('dotenv/config'); const {CdpClient} = await import('@coinbase/cdp-sdk'); const a = await new CdpClient().evm.createAccount(); console.log(a.address)"` once and copy the output:
```
CDP_API_KEY_ID=<your key id>
CDP_API_KEY_SECRET=<your key secret>
CDP_WALLET_SECRET=<your wallet secret>
CDP_WALLET_ADDRESS=<0x address from createAccount()>
```

**Privy** (`tests/signing-privy.test.mjs`) — app credentials and server wallet from [dashboard.privy.io](https://dashboard.privy.io/):
```
PRIVY_APP_ID=<your app id>
PRIVY_APP_SECRET=<your app secret>
PRIVY_WALLET_ID=<server wallet id>
PRIVY_WALLET_ADDRESS=<0x address of that wallet>
```

**Turnkey** (`tests/signing-turnkey.test.mjs`) — API keys and wallet from [app.turnkey.com](https://app.turnkey.com/):
```
TURNKEY_API_PUBLIC_KEY=<API public key>
TURNKEY_API_PRIVATE_KEY=<API private key>
TURNKEY_ORGANIZATION_ID=<organization id>
TURNKEY_SIGN_WITH=<0x wallet address>
```

All other tests (OWS, pay, search-bazaar, intents-quote, wallet, sign) use a well-known Hardhat/Anvil test key and require no wallet setup.

## Scripts

| Script | Commands |
|--------|----------|
| `scripts/wallet.mjs` | `address`, `balance`, `new` |
| `scripts/search-bazaar.mjs` | `search`, `details` |
| `scripts/intents-quote.mjs` | `quote`, `status` |
| `scripts/sign-x402-payment.mjs` | `sign`, `payload` |
| `scripts/pay.mjs` | _(single operation)_ |

Run any script without arguments to see its usage.
