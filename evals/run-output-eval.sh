#!/bin/bash
# Usage: bash evals/run-output-eval.sh [iteration]
#
# Runs output quality evals for the agent-payments skill — all evals and all
# grading calls run in parallel. Results are written to evals/workspace/iteration-<N>/
#
# Prerequisites:
#   1. claude CLI must be available (Claude Code)
#   2. jq must be installed
#   3. agent-payments/.env must exist with wallet credentials
#   4. NEAR_PRIVATE_KEY must be set in environment (or in agent-payments/.env)
#   5. The skill must be symlinked: ln -s <repo>/agent-payments ~/.claude/skills/agent-payments

ITER="${1:-1}"
WORKSPACE="evals/workspace/iteration-${ITER}"
EVALS_FILE="evals/evals.json"
SKILL_DIR="agent-payments"

mkdir -p "$WORKSPACE"

# Load wallet credentials from .env
if [ -f "$SKILL_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$SKILL_DIR/.env"
  set +a
fi

if [ -z "${NEAR_PRIVATE_KEY:-}" ]; then
  echo "Error: NEAR_PRIVATE_KEY is not set. Export it or add it to agent-payments/.env" >&2
  exit 1
fi

wallet_env() {
  local wallet="$1"
  local vars="NEAR_PRIVATE_KEY=${NEAR_PRIVATE_KEY}"
  case "$wallet" in
    raw)           vars="${vars} PRIVATE_KEY=${PRIVATE_KEY}" ;;
    cdp)           vars="${vars} CDP_API_KEY_ID=${CDP_API_KEY_ID} CDP_API_KEY_SECRET=${CDP_API_KEY_SECRET} CDP_WALLET_ADDRESS=${CDP_WALLET_ADDRESS} CDP_WALLET_SECRET=${CDP_WALLET_SECRET}" ;;
    privy)         vars="${vars} PRIVY_APP_ID=${PRIVY_APP_ID} PRIVY_APP_SECRET=${PRIVY_APP_SECRET} PRIVY_WALLET_ID=${PRIVY_WALLET_ID} PRIVY_WALLET_ADDRESS=${PRIVY_WALLET_ADDRESS}" ;;
    turnkey)       vars="${vars} TURNKEY_API_PUBLIC_KEY=${TURNKEY_API_PUBLIC_KEY} TURNKEY_API_PRIVATE_KEY=${TURNKEY_API_PRIVATE_KEY} TURNKEY_ORGANIZATION_ID=${TURNKEY_ORGANIZATION_ID} TURNKEY_SIGN_WITH=${TURNKEY_SIGN_WITH}" ;;
    payments-mcp)  ;;  # uses persisted session; only NEAR_PRIVATE_KEY needed
    *)             echo "Unknown wallet type: $wallet" >&2; exit 1 ;;
  esac
  echo "$vars"
}

count=$(jq '.evals | length' "$EVALS_FILE")

echo "Running $count evals in parallel against skill: agent-payments"
echo "Workspace: $WORKSPACE"
echo ""

# Phase 1: launch all evals in parallel
for i in $(seq 0 $((count - 1))); do
  eval_id=$(jq -r ".evals[$i].id" "$EVALS_FILE")
  wallet=$(jq -r ".evals[$i].wallet" "$EVALS_FILE")
  prompt=$(jq -r ".evals[$i].prompt" "$EVALS_FILE")
  outdir="${WORKSPACE}/${eval_id}"
  mkdir -p "$outdir"

  uses_mcp=$(jq -r ".evals[$i].uses_mcp // false" "$EVALS_FILE")

  if [ "$uses_mcp" = "true" ]; then
    (
      env $(wallet_env "$wallet") \
        claude -p "$prompt" \
        --permission-mode bypassPermissions \
        --output-format text \
        > "$outdir/output.txt" 2>&1
      echo "$eval_id: done"
    ) &
  else
    (
      env $(wallet_env "$wallet") \
        claude -p "$prompt" \
        --permission-mode bypassPermissions \
        --mcp-config '{"mcpServers":{}}' --strict-mcp-config \
        --output-format text \
        > "$outdir/output.txt" 2>&1
      echo "$eval_id: done"
    ) &
  fi
done

wait
echo ""
echo "All evals complete. Grading assertions in parallel..."
echo ""

# Phase 2: grade all assertions in parallel — each writes to its own temp file
tmpdir=$(mktemp -d)

for i in $(seq 0 $((count - 1))); do
  eval_id=$(jq -r ".evals[$i].id" "$EVALS_FILE")
  outdir="${WORKSPACE}/${eval_id}"
  assertions_count=$(jq ".evals[$i].assertions | length" "$EVALS_FILE")
  output_text=$(cat "$outdir/output.txt")

  for j in $(seq 0 $((assertions_count - 1))); do
    assertion=$(jq -r ".evals[$i].assertions[$j]" "$EVALS_FILE")
    (
      grade_raw=$(claude -p "$(printf 'Output:\n%s\n\nAssertion: "%s"\n\nDoes the output satisfy the assertion? Reply as JSON only: {"passed":true,"evidence":"one sentence"}' "$output_text" "$assertion")" \
        --mcp-config '{"mcpServers":{}}' --strict-mcp-config \
        --output-format text 2>/dev/null \
        | sed 's/^```json[[:space:]]*//;s/^```[[:space:]]*//' \
        | tr -d '\n' \
        | grep -o '{.*}' || echo '{"passed":false,"evidence":"grading failed"}')
      echo "$grade_raw" > "$tmpdir/grade_${i}_${j}.txt"
    ) &
  done
done

wait

# Phase 3: aggregate and report in eval order
total_pass=0
total_assertions=0

for i in $(seq 0 $((count - 1))); do
  eval_id=$(jq -r ".evals[$i].id" "$EVALS_FILE")
  wallet=$(jq -r ".evals[$i].wallet" "$EVALS_FILE")
  assertions_count=$(jq ".evals[$i].assertions | length" "$EVALS_FILE")
  outdir="${WORKSPACE}/${eval_id}"
  eval_pass=0
  > "$outdir/grading.json"

  echo "=== $eval_id (wallet: $wallet) ==="
  for j in $(seq 0 $((assertions_count - 1))); do
    assertion=$(jq -r ".evals[$i].assertions[$j]" "$EVALS_FILE")
    grade_raw=$(cat "$tmpdir/grade_${i}_${j}.txt" 2>/dev/null || echo '{"passed":false,"evidence":"grading failed"}')
    passed=$(echo "$grade_raw" | jq -r '.passed // false' 2>/dev/null || echo 'false')
    evidence=$(echo "$grade_raw" | jq -r '.evidence // "unknown"' 2>/dev/null || echo 'unknown')

    [ "$passed" = "true" ] && result="PASS" && eval_pass=$((eval_pass + 1)) || result="FAIL"

    printf "  %s  assertion %d/%d: %s\n" "$result" "$((j+1))" "$assertions_count" "${assertion:0:60}"
    printf "         evidence: %s\n" "$evidence"

    echo "$grade_raw" >> "$outdir/grading.json"
  done

  total_pass=$((total_pass + eval_pass))
  total_assertions=$((total_assertions + assertions_count))
  echo "  Score: $eval_pass/$assertions_count"
  echo ""
done

rm -rf "$tmpdir"
echo "=== Total: $total_pass/$total_assertions assertions passed ==="
echo "Results in $WORKSPACE/"
