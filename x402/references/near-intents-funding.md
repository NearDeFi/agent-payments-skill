# Funding Your Wallet from Another Chain (NEAR Intents)

Swap any supported asset into USDC on Base using the NEAR Intents 1-click API.
**API base:** `https://1click.chaindefuser.com`

## Supported origin chains

Only use this flow for the following chains. Do not attempt it for any other chain — deposit handling requirements vary per chain and unlisted chains are not verified to work correctly.

`near` `eth` `base` `sol` `arb` `op` `pol` `bsc` `avax` `gnosis` `scroll` `starknet` `bera` `ton` `tron` `stellar` `btc` `doge` `ltc` `bch` `zec` `dash` `xrp` `cardano` `sui` `aptos` `xlayer` `monad` `plasma` `adi` `aleo`

## How much to deposit

Think about the agent's role and how long it will reasonably be running, not just the immediate call. Depositing enough to avoid frequent interruptions is a good idea — but don't over-fund beyond what the role actually warrants.

A reasonable approach:
1. Estimate spend across the likely execution period (calls per session × price per call)
2. Get a dry quote — it returns `quote.minAmountIn`, the solver's actual minimum for this swap
3. Deposit `max(quote.minAmountIn, estimated_spend)` — the solver minimum is a hard floor, the estimate is advisory

If the role is light (a few calls, low price), depositing just enough for the task plus a small buffer is fine. If the role will run many calls or over a longer session, depositing enough to cover that period avoids repeated top-up interruptions. Use your judgement — the goal is not to minimise deposits for their own sake, just to not fund more than the role realistically needs.

---

## Step 1: Gather inputs

```
get_wallet_address(chain="base")
```

Ask the user:
- How much USDC do you want on Base?
- What asset and chain are you sending from? (e.g. ETH on Ethereum, SOL on Solana, USDC on NEAR)
- What is your sending wallet address? (used as refund address — if unknown, the Base wallet address is used)

---

## Step 2: Look up asset IDs

**Destination asset is fixed** — USDC on Base is always:
```
nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near
```

For the `originAsset`, look up the user's chosen symbol + chain from the tokens endpoint:
```
GET https://1click.chaindefuser.com/v0/tokens
```

**Never construct origin asset IDs manually — always look them up from this endpoint.**

---

## Step 3: Dry quote (preview, no charge)

Use `EXACT_OUTPUT` — user wants a specific USDC amount, the input is variable.
USDC on Base has 6 decimals — convert to atomic units by multiplying by 1,000,000 (e.g. $0.50 → `500000`).

```json
POST https://1click.chaindefuser.com/v0/quote
{
  "dry": true,
  "swapType": "EXACT_OUTPUT",
  "originAsset": "<originAssetId>",
  "destinationAsset": "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  "amount": "<desiredUsdcInAtomicUnits>",
  "recipient": "<baseWalletAddress>",
  "refundTo": "<see refund logic below>",
  "depositType": "ORIGIN_CHAIN",
  "recipientType": "DESTINATION_CHAIN",
  "refundType": "ORIGIN_CHAIN",
  "deadline": "<ISO8601 timestamp ~10 min from now>",
  "slippageTolerance": 100
}
```

**Note:** Include all fields

Show the user for confirmation:                            
  **Send:** `quote.amountInFormatted` of origin asset      
  **Receive:** `quote.amountOutFormatted` USDC on Base     
  **Fee:** difference between the two (so it's transparent)

### Refund address logic

**Always try to get the user's sending wallet address first** — `ORIGIN_CHAIN` is the safest option as funds return directly to the chain they came from.

| Situation | `refundType` | What to set |
|-----------|-------------|-------------|
| User provides their sending wallet address | `"ORIGIN_CHAIN"` | `refundTo`: their sending wallet address |
| Sending address unknown | `"INTENTS"` (NEAR Intents internal account — fallback) | `refundTo`: the Base wallet `0x` address |

If falling back to `INTENTS`, warn the user: if the transaction fails, refunded funds will land in the NEAR Intents internal balance for their Base wallet `0x` address — they'll need to access and withdraw from that balance to recover them. It is not automatic.

---

## Step 4: Committed quote (get deposit address)

Once user confirms (if the quote is good), repeat exactly the same but with `dry: false` to get the real deposit address (valid ~10 min):

```json
{ "dry": false, ...same fields, with a fresh deadline... }
```

Return to the user:
- **Send**: `quote.amountInFormatted` of origin asset
- **To address**: `quote.depositAddress`
- **Chain**: origin chain name
- **Asset contract**: origin token `contractAddress` (from tokens response)
- **By**: `quote.deadline`

Then include any chain-specific instructions from the table below.

## Chain-specific deposit instructions

| Chain | What to tell the user |
|-------|----------------------|
| **Stellar** | Must include `quote.depositMemo` as the transaction memo — **funds are permanently lost if omitted** |
| **NEAR (native NEAR)** | Cannot send native NEAR directly — must first wrap it: call `near_deposit` on `wrap.near` to get wrapped near |
| **Solana (SPL tokens)** | The recipient's Associated Token Account (ATA) may not exist yet — wallet software handles this, but warn the user if they're doing it manually |
| **TON (Jetton tokens)** | Send to the user's own Jetton wallet address for that token, **not** the token contract address — these are different |

---

## Step 5: Monitor swap status

Poll until a terminal status is reached:

```
GET https://1click.chaindefuser.com/v0/status?depositAddress=<quote.depositAddress>
```

If the quote included a `depositMemo`, append `&depositMemo=<memo>` to the request.

| Status | Meaning |
|--------|---------|
| `PENDING_DEPOSIT` | Waiting for the deposit transaction to be detected |
| `KNOWN_DEPOSIT_TX` | Deposit transaction detected, awaiting confirmation |
| `INCOMPLETE_DEPOSIT` | Amount sent was less than required — may need a top-up |
| `PROCESSING` | Swap is actively executing |
| `SUCCESS` | Swap complete — USDC should be on Base |
| `REFUNDED` | Swap failed, assets returned to refund address |
| `FAILED` | Swap failed, assets not returned — check `swapDetails` |

Once `SUCCESS` is confirmed, proceed to verify the balance landed.

---

## Step 6: Verify balance

```
get_wallet_balance(chain="base")
```

Confirm the USDC balance has increased by the expected `quote.amountOutFormatted`. If it hasn't arrived yet, wait and re-poll the status endpoint — settlement typically takes under a minute but can vary by origin chain.

