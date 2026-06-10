# Funding via Onramp (Cash App / Robinhood / Revolut)

For a user who has **no crypto in any wallet to swap from**, or who simply wants to fund
from a consumer app they already use. The user sends **USDC on Solana** from Cash App,
Robinhood, or Revolut; NEAR Intents 1Click routes it to USDC on the configured Base
wallet. This reuses the standard funding flow in `references/near-intents-funding.md` —
this file only covers the sender-app specifics.

## When to use

- The balance check (SKILL.md Step 4) found no Base USDC **and** no on-chain source to swap from.
- The user picked the **"fund via onramp"** option in "Determine source of funds".

## The route — Solana USDC only

These apps reliably withdraw **USDC on Solana**, and 1Click routes Solana USDC → Base
USDC. So always fund with `--from sol:USDC`.

- **Never** ask the user to send to a Base address (or any non-Solana network) directly from these apps.
- The destination is the configured Base wallet (`--wallet`) — get it per `references/wallet-flows.md`. Works for any backend (awal / CDP / Privy / Turnkey / raw key).

## Refund handling — choose `--refund` / `--refund-type` by wallet type

A failed/partial swap refunds the **origin** asset (Solana USDC), not Base USDC. Pick the
refund target the user can actually recover from (see `--refund-type` in
`references/near-intents-funding.md`):

| Wallet backend | `--refund-type` | `--refund` |
|---|---|---|
| **Self-custody / raw private key (EVM)** | `intents` | omit — defaults to the `--wallet` Base address; reclaim by connecting that wallet at app.near-intents.org |
| **awal** (managed, has a Solana address) | `origin` | the wallet's own Solana address — `npx awal@2.10.0 address --json` |
| **CDP / Privy / Turnkey** (managed, EVM-only) | `origin` | a **Solana address the user controls** — ask them for one |

Do **not** use `--refund-type intents` for managed wallets — they can't connect
to NEAR Intents to claim, so the refund would be stranded. Note that a Cash App /
Robinhood / Revolut withdrawal address is **not** a safe `origin` refund target — those
are custodial and may not credit an inbound refund.

## Run the quote and monitor

Use `references/near-intents-funding.md` directly — do not reinvent the commands:

1. **Step 3 (quote)** with `--from sol:USDC`, the `--wallet`/`--refund`/`--refund-type` chosen above.
2. **Confirm the refund destination** with the user (the `Refund to:` line) — required before any send.
3. Show the user the funding prompt below — it **must include the `Valid until:` time limit** from the quote. If the deadline passes before the user sends, run a fresh quote and re-show the prompt with the new address, amount, and deadline.
4. **Step 4 (monitor)** the swap to a terminal status, then verify the Base balance (Step 5).

### Funding prompt to show the user

Adapt this once the quote prints (values come straight from the quote output):

```text
Before I make the payment, please send <Send amount> USDC on Solana from Cash App, Robinhood, or Revolut.

This quote is valid until <Valid until: time> (about <minutes> minutes from now) — the deposit must arrive by then. If you can't send in time, tell me and I'll get a fresh quote.

Reason: NEAR Intents 1Click receives USDC on Solana, routes it to USDC on Base, and delivers it to your Base wallet. Expected Base output: <Receive amount> USDC.

Solana USDC deposit address:
<Deposit to: address>

QR (optional, scannable in Robinhood): https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=<Deposit to: address>
After scanning, check the address your app shows matches the deposit address above before sending.

If the swap fails, your refund goes to: <Refund to: line — confirm this with me first>.

Cash App / Robinhood / Revolut:
Selected network: Solana.
1. Enter <Send amount> USDC.
2. Paste the Solana deposit address (set the network to Solana). Some apps also let you scan its QR.
3. Send.

Reply with the Solana transaction signature when sent (or just "sent"), and I'll track it.
```
