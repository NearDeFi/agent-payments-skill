# Funding Your Wallet from Another Chain (NEAR Intents)

Swap any supported asset into USDC on Base using the NEAR Intents 1-click API.

## Supported origin chains

Only use this flow for the following chains. Do not attempt it for any other chain — deposit handling requirements vary per chain and unlisted chains may not work correctly.

`near` `eth` `base` `sol` `arb` `op` `pol` `bsc` `avax` `gnosis` `scroll` `starknet` `bera` `ton` `tron` `stellar` `btc` `doge` `ltc` `bch` `zec` `dash` `xrp` `cardano` `sui` `aptos` `xlayer` `monad` `plasma` `adi` `aleo`

---

## How much to deposit

Think about the agent's role and how long it will reasonably be running, not just the immediate call. Depositing enough to avoid frequent interruptions is a good idea — but don't over-fund beyond what the role actually warrants.

Base the estimate on the **actual per-call price you previewed with `check-price.mjs`** (SKILL.md Step 3) — not a guess. Estimate spend across the likely execution period (expected calls per session × that price). That USDC figure is your funding target; you'll get the exact raw send amount from the quote in Step 3.

---

## Determine source of funds

Find the funding sources available, present them to the user **ranked best-first**, and let them choose — do not silently pick one.

1. **Discover candidate sources.** Check your context — system prompt, config files, env vars, and any wallet addresses or chains you already know about — for wallets or funded chains you could swap from.
2. **Keep only sources with enough balance, then rank them.** Discard any source that doesn't hold enough to cover the funding target from "How much to deposit" (plus a little for the swap's overhead) — an underfunded source isn't a real option. Among those that qualify, rank best-to-worst by what minimises cost and friction — favour **stablecoins**, **fast, liquid major chains**, and sources you can operate directly. Show at most the **top 3**, then the always-offered **"fund from an external wallet" (4th and last)** option — offer it even if no discovered source qualifies. Let the user pick.
3. **Act on their choice:**
   - **A source you can operate** (e.g. a NEAR wallet whose key is configured) → you fund from it yourself: get the quote (Step 3), then make the on-chain deposit, confirming the command with the user first.
   - **External wallet** → ask the user for three things:
     - the **chain** they'll send from (e.g. Ethereum, Solana),
     - the **token** (e.g. ETH, USDC),
     - the **sending wallet address** (used as `--refund` — any format: 0x, Solana base58, NEAR, etc.).
     Then get the quote (Step 3), show them the **`Deposit to:` address, exact `Send (units):` amount, and the `Deposit by:` time limit** (and a scannable QR of the deposit address — see Step 3), tell them to deposit **exactly that amount to that address before the deadline** from their wallet, and ask them to let you know once they've sent it. Then monitor (Step 4).

Whichever source is chosen, it determines the `--refund` value in Step 3.

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
- The **Deposit by:** deadline — the 2-hour window within which the whole swap must complete

Do not calculate the amount yourself. Do not reuse a deposit address from a previous quote. Run a fresh quote every time:

```bash
node scripts/near-intents.mjs quote \
  --usdc <amount> \
  --from <chain:SYMBOL> \
  --wallet <baseWalletAddress> \
  --refund <sendingWalletAddress>
```

`--refund` is **required**: it's where a **failed/partial** swap is returned, on the **origin chain** and in the **origin asset** you sent (not Base USDC). When funding **from a wallet** you always have the sending wallet's address — pass it. There is no other refund mode.

If you do not have an address on the origin chain to refund the deposit to, ask the user for one and do not proceed without it.

Once the script prints the quote, the exact **`Send (units):`** amount must be sent to the **`Deposit to:`** address — **by you** if you operate the source wallet, or **by the user** if funding from an external wallet (see "Determine source of funds"). Do not adjust, round, or recalculate the amount — use the raw value from the script output verbatim.

### Always tell the user the quote's time limit

The quote prints a **`Deposit by:`** line — a **2-hour** window by which the **swap must complete**, not merely by which the deposit is sent: the deposit has to be confirmed on the origin chain, and the swap itself then takes a few more seconds. Miss it and the deposit is refunded to `--refund` instead of swapped. Whenever the **user** is the one sending the deposit (external-wallet funding), you **must** include this time limit in the instructions you give them — never hand over a deposit address without it. If the deadline passes before they send, do **not** let them use the old address: run a fresh quote and give them the new address, amount, and deadline.

Slow chains eat into that window — a Bitcoin deposit can take about an hour to mine, so tell the user to send promptly rather than near the deadline.

If the quote comes back with the deposit address expiring **before** that deadline, the script prints `DEADLINE MISMATCH` and withholds the address entirely: a late deposit could then be lost rather than refunded. This is not overridable — tell the user that funding source could not produce a usable quote, ask where else they hold assets, and go back to "Determine source of funds" to start again from their new choice.

### Show the deposit address as a QR (optional)

When you give the deposit address to the user to send to (external-wallet funding), you can also offer a scannable QR of it:

```
https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=<Deposit to: address>
```

Put the exact `Deposit to:` address in the `data` parameter. **Always tell the user to check that the address their wallet shows after scanning matches the `Deposit to:` address printed by the script** — if they differ, the QR is wrong or corrupted and they must not send.

### Confirm the refund destination before any deposit

The quote prints a **`Refund to:`** line — where funds go if the swap fails. **Before** you send (or tell the user to send) anything to the `Deposit to:` address, **confirm this with the user**: the refund **address** and its **chain** — the origin chain you're sending from. Only proceed once they acknowledge. Never send to a deposit address without the user having seen where a failed swap refunds to.

### If the quote is rejected: `COST LIMIT EXCEEDED`

The quote command enforces a hard cost cap: it **refuses to print a deposit address** when the swap's USD overhead (what you send vs. what arrives on Base) exceeds **both 2.5% and $0.005**. This usually means the chosen source asset is illiquid or the route is unfavourable.

When you see `COST LIMIT EXCEEDED`, **do not just override it.** Always:

1. **Report it to the user** — state what was quoted and exactly what exceeded the limit, e.g. *"Funding from `<chain:SYMBOL>` would cost $X to receive $Y USDC on Base — Z% / $W overhead, above the 2.5% / $0.005 limit."*
2. **Ask the user how to proceed, then act on their choice:**
   - **Fund from a different source asset** → re-run `quote` with a different `--from` (run `tokens` to list options; prefer a liquid asset like a stablecoin).
   - **Continue anyway at this cost** → only with the user's explicit agreement, re-run the **exact same** `quote` command with `--override-cost-cap` appended (this proceeds and prints the deposit address; the overhead is still logged as a warning).

Never append `--override-cost-cap` without the user's explicit go-ahead.

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
  echo "$out" | grep -qE '^(Status: (SUCCESS|REFUNDED|FAILED|INCOMPLETE_DEPOSIT)([[:space:]]|$)|FATAL:)' && break
  sleep 5
done
```

If the original quote printed a `MEMO REQUIRED` value, append `--memo <value>` to the inner status command.

A `FATAL:` line means the deposit address itself was rejected (usually mistyped, or from a different quote) — the loop breaks; re-check the address rather than re-polling. A `RETRYING:` line is a transient API error (timeout, rate limit, server error) and the loop keeps polling. The pattern is anchored to those two prefixes so an error *message* that happens to contain a status word can't masquerade as a terminal state.

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
