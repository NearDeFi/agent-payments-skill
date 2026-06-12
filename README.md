# x402 Pay

A skill for making HTTP 402 (x402) micropayments in USDC on Base. It can be funded cross-chain via NEAR Intents or from onramps like Cash App, Revolut, and Robinhood. Designed to work across most agent frameworks (Claude Code, OpenClaw, etc.) and to be compatible with multiple agent wallet setups.

Before using this skill, please review the [DISCLOSURES.txt](./DISCLOSURES.txt) and [NOTICE.txt](./NOTICE.txt) files.

## Recommended agent setup

This skill moves real money. Configure your agent/harness so it **asks for approval before executing commands** rather than running them automatically. Keep wallet-level spend limits in place, and **review every transaction** — confirm the price, recipient, and amount before approving. 

## Install

Skills install:

```bash
npx skills add NearDeFi/agent-payments-skill
```

OpenClaw install:

```bash
openclaw skills install x402-pay
```

## Usage

```
Fetch the crypto news using x402
```

```
Search for x402 services that do web search
```

```
Fund my x402 wallet from my Tron wallet
```

```
Fund my x402 wallet via Cash App
```

```
Look up the DNS records for example.com using x402
```

## Wallet configuration

The skill will check the agent's context for configured wallets. It requires a wallet on Base, and will either use an existing wallet or create one if none is already configured. The skill has explicit wallet support for AWAL, CDP, Privy, Turnkey, and private key. To use your AWAL wallet, log in via the terminal where the agent executes commands. For other wallets, configure the relevant environment variables in a `.env` file in the root of your agent.

```env
# To use CDP configure the following environment variables
CDP_API_KEY_ID=
CDP_API_KEY_SECRET=
CDP_WALLET_ADDRESS=
CDP_WALLET_SECRET=

# To use Privy configure the following environment variables
PRIVY_APP_ID=
PRIVY_APP_SECRET=
PRIVY_WALLET_ID=
PRIVY_WALLET_ADDRESS=

# To use Turnkey configure the following environment variables
TURNKEY_API_PUBLIC_KEY=
TURNKEY_API_PRIVATE_KEY=
TURNKEY_ORGANIZATION_ID=
TURNKEY_SIGN_WITH=

# To use a private key configure the following environment variables
X402_PRIVATE_KEY=
```

The agent also requires funds to use the skill. These funds can be in the configured base wallet or in any wallet that NEAR Intents supports. You should give your agent context on how to transfer funds from the wallet and which assets from the wallet you would like the agent to use.

For example if you have funds in a NEAR wallet, in your task prompt or CLAUDE.md file you could state:

```txt
You have USDC in your NEAR account. Its account ID is in the NEAR_ACCOUNT_ID environment variable and a NEAR_PRIVATE_KEY is configured in the .env file in the agent root.

To send USDC from NEAR (USDC contract: 17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1):

node --input-type=module -e "
  import { Account, JsonRpcProvider, KeyPairSigner } from 'near-api-js';
  const provider = new JsonRpcProvider({ url: 'https://free.rpc.fastnear.com' });
  const signer = KeyPairSigner.fromSecretKey(process.env.NEAR_PRIVATE_KEY);
  const account = new Account(process.env.NEAR_ACCOUNT_ID, provider, signer);
  const USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
  // Register the deposit address for USDC storage first (no-op if already registered; ft_transfer panics without it)
  await account.callFunctionRaw({ contractId: USDC, methodName: 'storage_deposit', args: { account_id: '<DEPOSIT_ADDRESS>' }, deposit: 1250000000000000000000n, gas: 30000000000000n });
  const r = await account.callFunctionRaw({ contractId: USDC, methodName: 'ft_transfer', args: { receiver_id: '<DEPOSIT_ADDRESS>', amount: '<AMOUNT_IN>' }, deposit: 1n, gas: 30000000000000n });
  console.log(r.transaction.hash);
  "

Install near-api-js if not present: npm install near-api-js@7.2.0 (in x402-pay directory)
```

## RPC provider configuration

`scripts/wallet.mjs balance` defaults to the public Base RPC (`https://mainnet.base.org`), which is rate-limited. For production, point it at your own provider via env vars in `.env`:

```
BASE_RPC_URL=https://your-provider.example
BASE_RPC_KEY=<bearer token>   # optional
```

## Tests

Run the suite with:

```bash
npm run test
```

Tests are integration tests and require network connection. The wallet-signing tests require their wallet credentials in `x402-pay/.env`:

```env
CDP_API_KEY_ID=
CDP_API_KEY_SECRET=
CDP_WALLET_ADDRESS=
CDP_WALLET_SECRET=

PRIVY_APP_ID=
PRIVY_APP_SECRET=
PRIVY_WALLET_ID=
PRIVY_WALLET_ADDRESS=

TURNKEY_API_PUBLIC_KEY=
TURNKEY_API_PRIVATE_KEY=
TURNKEY_ORGANIZATION_ID=
TURNKEY_SIGN_WITH=
```

## Evals

The evals require `claude` CLI and `jq`, and the skill symlinked so headless sessions can load it:

```bash
ln -s "$(pwd)/x402-pay" ~/.claude/skills/x402-pay
```

There are two kinds of evals, both run headless `claude` sessions against the skill:

- **`npm run eval:description`** — *trigger* evals. Fires a set of user queries and checks the skill activates when it should (and stays quiet when it shouldn't). No wallet, no payments.
- **`npm run eval:output`** — *end-to-end* evals. Runs the full flow (discover service → fund cross-chain → pay) for each wallet type and grades the result plus a no-errors check. **Spends real USDC** 

**`eval:output` additionally needs real funds and credentials** in `x402-pay/.env`: a NEAR account (`NEAR_ACCOUNT_ID` + `NEAR_PRIVATE_KEY`) as the cross-chain funding source, funded with **~0.1 USDC** to cover all funded evals plus **~0.02 NEAR** for gas, and the wallet credentials for whichever wallets you're testing (see the env block under [Wallet configuration](#wallet-configuration)). You also need to log in to your awal account before running the evals `npx awal@2.10.0 auth login you@example.com`.

Results are written to `evals/workspace/iteration-<N>/`.
