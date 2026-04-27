# Using x402 with Coinbase payments-mcp

If `make_http_request_with_x402` is available in your tools, use this flow. It handles auth, signing, and retries automatically — no scripts needed.

For finding a service, use `search-services.mjs` as described in `skill.md` — same as all other wallets.

---

## Auth

```
check_session_status()
```

- **Signed in** → proceed
- **Not signed in** → call `show_wallet_app()` immediately, wait for user to sign in, then continue

Sign in via email OTP if needed:
```
sign_in_with_email(email="you@example.com")
# User receives 6-digit code → then:
verify_email_otp(flowId="<flowId from above>", otp="<6-digit code>")
```

---

## Pay

**Always show the price before paying. Confirm if > $0.10 USDC.**

```
make_http_request_with_x402(baseURL="<base URL>", path="<path>", method="<GET|POST>", body={...})
```

`make_http_request_with_x402` handles the 402 → sign → retry flow automatically.

---

## Wallet Utilities

For Step 3 (balance check), use `get_wallet_balance(chain="base")`.

| Task | Tool call |
|------|-----------|
| Check USDC balance | `get_wallet_balance(chain="base")` |
| Get wallet address | `get_wallet_address(chain="base")` |
| Send tokens | `send(to="0x... or name.eth", amount="1.00", asset="usdc", chain="base")` |
| Swap tokens | `trade(fromAsset="usdc", toAsset="eth", amount="10.00", chain="base")` |
| Open wallet UI | `show_wallet_app()` |

**Supported chains:** `base`, `base-sepolia`, `polygon`, `solana`, `solana-devnet`
**Supported assets (Base):** `usdc`, `eth`, `weth`
**Supported assets (Polygon):** `usdc`, `pol`, `wmatic`

---

## No payments-mcp?

If payments-mcp tools are not available, fall back to `references/wallet-flows.md` to set up a wallet using a private key.
