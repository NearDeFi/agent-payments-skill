# Funding Your Wallet from Another Chain (NEAR Intents)

Swap any supported asset into USDC on Base using the NEAR Intents 1-click API.

## Supported origin chains

Only use this flow for the following chains. Do not attempt it for any other chain — deposit handling requirements vary per chain and unlisted chains are not verified to work correctly.

`near` `eth` `base` `sol` `arb` `op` `pol` `bsc` `avax` `gnosis` `scroll` `starknet` `bera` `ton` `tron` `stellar` `btc` `doge` `ltc` `bch` `zec` `dash` `xrp` `cardano` `sui` `aptos` `xlayer` `monad` `plasma` `adi` `aleo`

## How much to deposit

Think about the agent's role and how long it will reasonably be running, not just the immediate call. Depositing enough to avoid frequent interruptions is a good idea — but don't over-fund beyond what the role actually warrants.

A reasonable approach:
1. Estimate spend across the likely execution period (calls per session × price per call)
2. Get a dry quote — it returns `quote.minAmountIn`, the solver's actual minimum for this swap
3. Deposit `max(quote.minAmountIn, estimated_spend)` — the solver minimum is a hard floor, the estimate is advisory

---

## Step 1: Get your Base wallet address

With payments-mcp:
```
get_wallet_address(chain="base")
```

Without payments-mcp:
```bash
node scripts/wallet.mjs address
```

Or get the address using the appropriate wallet infrastructure being used.

**Determine the source of funds — check your context before asking the user.**

Look in your system prompt, config files, env vars, and any wallet addresses or chains you already know about. The agent may have a wallet or funds on another chain that can be used directly.

- **If you find another wallet or funded chain:** use it as the source. Prefer liquid assets (native token or stablecoins). Use that wallet's address as `--refund`.
- **If you find nothing:** ask the user:
  - What asset and chain do you want to send from? (e.g. ETH on Ethereum, SOL on Solana)
  - What is your sending wallet address? (used as `--refund` — any format: 0x, Solana base58, NEAR, etc.)

For deposit amount: use the estimation approach in [How much to deposit](#how-much-to-deposit) above — always check `quote.minAmountIn` via a dry quote before committing.

---

## Step 2: Dry quote (preview, no charge)

```bash
node scripts/intents-quote.mjs quote --dry \
  --usdc <amount> \
  --from <chain:SYMBOL> \
  --refund <sendingWalletAddress> \
  --wallet <baseWalletAddress>
```

Example — swap 1 ETH worth into USDC:
```bash
node scripts/intents-quote.mjs quote --dry --usdc 50.00 --from eth:ETH --refund <yourSendingAddress> --wallet 0xYourBaseAddress
```

Show the user for confirmation:
- **Send:** amount and asset shown in output
- **Receive:** USDC amount shown in output

### Refund address

Always provide `--refund` with the user's sending wallet address — if the swap fails, funds return directly to that address.

If the sending address is unknown, omit `--refund`. The script will warn you: refunded funds will land in the NEAR Intents internal balance for the Base wallet address and must be manually withdrawn to recover them.

---

## Step 3: Committed quote (get deposit address)

Once the user confirms, run the same command without `--dry`:

```bash
node scripts/intents-quote.mjs quote \
  --usdc <amount> \
  --from <chain:SYMBOL> \
  --refund <sendingWalletAddress> \
  --wallet <baseWalletAddress>
```

The script outputs the deposit address, asset contract, and deadline. Give all of these to the user along with any chain-specific instructions below.

## Chain-specific deposit instructions

| Chain | What to tell the user |
|-------|----------------------|
| **Stellar** | Must include the `MEMO REQUIRED` value printed by the script as the transaction memo — **funds are permanently lost if omitted** |
| **NEAR (native NEAR)** | Cannot send native NEAR directly — must first wrap it: call `near_deposit` on `wrap.near` to get wrapped NEAR |
| **NEAR (NEP-141 tokens)** | No storage deposit needed — the 1-click API deposit address already has storage registered for all supported tokens |
| **Solana (SPL tokens)** | The recipient's Associated Token Account (ATA) may not exist yet — wallet software handles this, but warn the user if they're doing it manually |
| **TON (Jetton tokens)** | Send to the user's own Jetton wallet address for that token, **not** the token contract address — these are different |

---

## Step 4: Monitor swap status

Poll until a terminal status is reached:

```bash
node scripts/intents-quote.mjs status <depositAddress>
```

If the original quote printed a `MEMO REQUIRED` value, append `--memo <value>` to the status command.

| Status | Meaning |
|--------|---------|
| `PENDING_DEPOSIT` | Waiting for the deposit transaction to be detected |
| `KNOWN_DEPOSIT_TX` | Deposit detected, awaiting confirmation |
| `INCOMPLETE_DEPOSIT` | Amount sent was less than required — may need a top-up |
| `PROCESSING` | Swap is actively executing |
| `SUCCESS` | Swap complete — USDC should be on Base |
| `REFUNDED` | Swap failed, assets returned to refund address |
| `FAILED` | Swap failed, assets not returned — check details in output |

---

## Step 5: Verify balance

With payments-mcp:
```
get_wallet_balance(chain="base")
```

Without payments-mcp:
```bash
node scripts/wallet.mjs balance <baseWalletAddress>
```

Confirm the USDC balance has increased by the expected amount. If it hasn't arrived yet, wait and re-poll — settlement typically takes under a minute but can vary by origin chain.
