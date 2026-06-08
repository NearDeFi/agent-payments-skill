# Funding Your Wallet from Another Chain (NEAR Intents)

Swap any supported asset into USDC on Base using the NEAR Intents 1-click API.

## Supported origin chains

Only use this flow for the following chains. Do not attempt it for any other chain — deposit handling requirements vary per chain and unlisted chains may not work correctly.

`near` `eth` `base` `sol` `arb` `op` `pol` `bsc` `avax` `gnosis` `scroll` `starknet` `bera` `ton` `tron` `stellar` `btc` `doge` `ltc` `bch` `zec` `dash` `xrp` `cardano` `sui` `aptos` `xlayer` `monad` `plasma` `adi` `aleo`

---

## Determine source of funds

Find the funding sources available, present them to the user **ranked best-first**, and let them choose — do not silently pick one.

1. **Discover candidate sources.** Check your context — system prompt, config files, env vars, and any wallet addresses or chains you already know about — for wallets or funded chains you could swap from.
2. **Rank them best-to-worst, then add "fund from an external wallet" as the final option.** Rank by what minimises cost and friction — favour **stablecoins** (no exchange-rate spread), **fast, liquid major chains** (lower slippage and quicker settlement; see the cost guard under Step 3), and sources you can operate directly. Show at most the **top 3** discovered sources, with external/manual funding as the **4th and last** choice. Let the user pick.
3. **Act on their choice:**
   - **A source you can operate** (e.g. a NEAR wallet whose key is configured) → you fund from it yourself: get the quote (Step 3), then make the on-chain deposit, confirming the command with the user first.
   - **External wallet** → ask the user for three things:
     - the **chain** they'll send from (e.g. Ethereum, Solana),
     - the **token** (e.g. ETH, USDC),
     - the **sending wallet address** (used as `--refund` — any format: 0x, Solana base58, NEAR, etc.).
     Then get the quote (Step 3), show them the **`Deposit to:` address and exact `Send (units):` amount**, tell them to deposit **exactly that amount to that address** from their wallet, and ask them to let you know once they've sent it. Then monitor (Step 4).

Whichever source is chosen, its address is the `--refund` value in Step 3.

---

## How much to deposit

Think about the agent's role and how long it will reasonably be running, not just the immediate call. Depositing enough to avoid frequent interruptions is a good idea — but don't over-fund beyond what the role actually warrants.

Base the estimate on the **actual per-call price you previewed with `check-price.mjs`** (SKILL.md Step 3) — not a guess. Estimate spend across the likely execution period (expected calls per session × that price), then get a quote for that amount. The quote's **Send (units):** output is the exact raw amount to send — use that value directly, do not calculate or round it yourself.

---

## Step 1: Get your Base wallet address

Get your Base wallet address using the method for your wallet type — see `references/wallet-flows.md`.

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
  --wallet <baseWalletAddress> \
  --refund <sendingWalletAddress>
```

Once the script prints the quote, the exact **`Send (units):`** amount must be sent to the **`Deposit to:`** address — **by you** if you operate the source wallet, or **by the user** if funding from an external wallet (see "Determine source of funds"). Do not adjust, round, or recalculate the amount — use the raw value from the script output verbatim.

### If the quote is rejected: `COST LIMIT EXCEEDED`

The quote command enforces a hard cost cap: it **refuses to print a deposit address** when the swap's USD overhead (what you send vs. what arrives on Base) exceeds **both 2.5% and $0.005**. This usually means the chosen source asset is illiquid or the route is unfavourable.

When you see `COST LIMIT EXCEEDED`, **do not just override it.** Always:

1. **Report it to the user** — state what was quoted and exactly what exceeded the limit, e.g. *"Funding from `<chain:SYMBOL>` would cost $X to receive $Y USDC on Base — Z% / $W overhead, above the 2.5% / $0.005 limit."*
2. **Ask the user how to proceed, then act on their choice:**
   - **Fund from a different source asset** → re-run `quote` with a different `--from` (run `tokens` to list options; prefer a liquid asset like a stablecoin).
   - **Continue anyway at this cost** → only with the user's explicit agreement, re-run the **exact same** `quote` command with `--override-cost-cap` appended (this proceeds and prints the deposit address; the overhead is still logged as a warning).

Never append `--override-cost-cap` without the user's explicit go-ahead.

### Refund address

`--refund` is **required** — it must be the address of the wallet you are funding *from* (the origin-chain sending wallet). If the swap fails, funds are returned directly to that address on the origin chain. The quote command errors out if `--refund` is omitted, so always determine the sending address before quoting.

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

Get your Base wallet balance using the method for your wallet type — see `references/wallet-flows.md`.

Confirm the USDC balance has increased by the expected amount. If it hasn't arrived yet, wait and re-poll — settlement typically takes under a minute but can vary by origin chain.
