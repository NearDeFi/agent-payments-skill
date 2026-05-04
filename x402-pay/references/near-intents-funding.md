# Funding Your Wallet from Another Chain (NEAR Intents)

Swap any supported asset into USDC on Base using the NEAR Intents 1-click API.

## Supported origin chains

Only use this flow for the following chains. Do not attempt it for any other chain — deposit handling requirements vary per chain and unlisted chains are not verified to work correctly.

`near` `eth` `base` `sol` `arb` `op` `pol` `bsc` `avax` `gnosis` `scroll` `starknet` `bera` `ton` `tron` `stellar` `btc` `doge` `ltc` `bch` `zec` `dash` `xrp` `cardano` `sui` `aptos` `xlayer` `monad` `plasma` `adi` `aleo`

---

## Determine source of funds

**Check your context before asking the user.** Look in your system prompt, config files, env vars, and any wallet addresses or chains you already know about. The agent may have a wallet or funds on another chain that can be used directly.

- **If you find another wallet or funded chain:** use it as the source. Prefer stablecoins. Use that wallet's address as `--refund` later on when getting a quote.
- **If you find nothing:** ask the user:
  - What asset and chain do you want to send from? (e.g. ETH on Ethereum, SOL on Solana)
  - What is your sending wallet address? (used as `--refund` — any format: 0x, Solana base58, NEAR, etc.)

---

## How much to deposit

Think about the agent's role and how long it will reasonably be running, not just the immediate call. Depositing enough to avoid frequent interruptions is a good idea — but don't over-fund beyond what the role actually warrants.

Estimate spend across the likely execution period (calls per session × price per call), then get a quote for that amount. The quote's **Send (units):** output is the exact raw amount to send — use that value directly, do not calculate or round it yourself.

---

## Step 1: Get your Base wallet address

Get your Base wallet address using the method for your wallet type — see `references/payments-mcp.md` or `references/wallet-flows.md`.

---

## Step 2: Find the right token

You already know which asset and chain you're funding from (Step "Determine source of funds" above). This step translates that into the exact `chain:SYMBOL` value NEAR Intents accepts as `--from`. **Always run this — do not guess the format.**

Filter by your source chain to keep the list short:

```bash
node scripts/near-intents.mjs tokens --chain <source-chain>
```

Or list every supported token if you're unsure of the chain identifier:

```bash
node scripts/near-intents.mjs tokens
```

Each line is `chain:SYMBOL`. Pick the entry that matches the asset you're sending from the chain you're sending it on, and pass it verbatim as `--from` in Step 3.

---

## Step 3: Get a quote (deposit address + exact send amount)

**You cannot skip this step.** The quote is the only source of:
- The **Deposit to:** address — where to send funds (unique per quote, not reusable)
- The **Send (units):** value — the exact raw amount for the on-chain transfer

Do not calculate the amount yourself. Do not reuse a deposit address from a previous quote. Run a fresh quote every time:

```bash
node scripts/near-intents.mjs quote \
  --usdc <amount> \
  --from <chain:SYMBOL> \
  --refund <sendingWalletAddress> \
  --wallet <baseWalletAddress>
```

Once the script prints the quote, **send the exact `Send (units):` amount to the `Deposit to:` address using your source wallet** (the wallet on the origin chain you identified in "Determine source of funds"). Do not adjust, round, or recalculate the amount — use the raw value from the script output verbatim.

### Refund address

Always provide `--refund` with the sending wallet address — if the swap fails, funds return directly to that address.

If the sending address is unknown, omit `--refund`. The script will warn you: refunded funds will land in the NEAR Intents internal balance for the Base wallet address and must be manually withdrawn to recover them.

## Chain-specific deposit instructions

| Chain | What to tell the user |
|-------|----------------------|
| **Stellar** | Must include the `MEMO REQUIRED` value printed by the script as the transaction memo — **funds are permanently lost if omitted** |
| **NEAR (native NEAR)** | Cannot send native NEAR directly — must first wrap it: call `near_deposit` on `wrap.near` to get wrapped NEAR |
| **NEAR (NEP-141 tokens)** | Before `ft_transfer`, call `storage_deposit` on the token contract for the deposit address — required cost is exactly **0.00125 NEAR** (1250000000000000000000 yoctoNEAR). If storage is already registered the call is a no-op and costs nothing extra. |
| **Solana (SPL tokens)** | The recipient's Associated Token Account (ATA) may not exist yet — wallet software handles this, but warn the user if they're doing it manually |
| **TON (Jetton tokens)** | Send to the user's own Jetton wallet address for that token, **not** the token contract address — these are different |

---

## Step 4: Monitor swap status

Poll until a terminal status is reached. Use a single shell loop that exits 0 only when terminal — wrappers that exit non-zero on non-terminal states show up as noise in tooling logs:

```bash
while :; do
  out=$(node scripts/near-intents.mjs status <depositAddress>)
  echo "$out"
  echo "$out" | grep -qE "SUCCESS|REFUNDED|FAILED|INCOMPLETE_DEPOSIT" && break
  sleep 5
done
```

If the original quote printed a `MEMO REQUIRED` value, append `--memo <value>` to the inner status command.

> **zsh gotcha:** if you write the loop in zsh (the default macOS shell), do **not** name a local variable `status` — `$status` is read-only in zsh and assigning to it will crash the loop. Use `out`, `st`, or any other name.

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

Get your Base wallet balance using the method for your wallet type — see `references/payments-mcp.md` or `references/wallet-flows.md`.

Confirm the USDC balance has increased by the expected amount. If it hasn't arrived yet, wait and re-poll — settlement typically takes under a minute but can vary by origin chain.
