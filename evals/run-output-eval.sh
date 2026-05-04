#!/bin/bash
# Usage: bash evals/run-output-eval.sh [iteration]
#
# Runs output quality evals for the x402-pay skill — all evals and all
# grading calls run in parallel. Results are written to evals/workspace/iteration-<N>/
#
# Prerequisites:
#   1. claude CLI must be available (Claude Code)
#   2. jq must be installed
#   3. x402-pay/.env must exist with wallet credentials
#   4. NEAR_PRIVATE_KEY must be set in environment (or in x402-pay/.env)
#   5. The skill must be symlinked: ln -s <repo>/x402-pay ~/.claude/skills/x402-pay

ITER="${1:-1}"
WORKSPACE="evals/workspace/iteration-${ITER}"
EVALS_FILE="evals/evals.json"
SKILL_DIR="x402-pay"

mkdir -p "$WORKSPACE"

# Load wallet credentials from .env
if [ -f "$SKILL_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$SKILL_DIR/.env"
  set +a
fi

if [ -z "${NEAR_PRIVATE_KEY:-}" ]; then
  echo "Error: NEAR_PRIVATE_KEY is not set. Export it or add it to x402-pay/.env" >&2
  exit 1
fi

# Wallet-specific credentials come from the sourced .env above (set -a marks them as
# exported), so they're inherited by every claude subprocess automatically. The wallet
# field in evals.json is preserved for reporting only.

count=$(jq '.evals | length' "$EVALS_FILE")

echo "Running $count evals in parallel against skill: x402-pay"
echo "Workspace: $WORKSPACE"
echo ""

# Phase 1: launch all evals in parallel — capture stream-json so we can extract errors
for i in $(seq 0 $((count - 1))); do
  eval_id=$(jq -r ".evals[$i].id" "$EVALS_FILE")
  wallet=$(jq -r ".evals[$i].wallet" "$EVALS_FILE")
  prompt=$(jq -r ".evals[$i].prompt" "$EVALS_FILE")
  outdir="${WORKSPACE}/${eval_id}"
  mkdir -p "$outdir"

  uses_mcp=$(jq -r ".evals[$i].uses_mcp // false" "$EVALS_FILE")
  mcp_args="--mcp-config {\"mcpServers\":{}} --strict-mcp-config"
  [ "$uses_mcp" = "true" ] && mcp_args=""

  (
    claude_failed=0
    claude -p "$prompt" \
      --permission-mode bypassPermissions \
      $mcp_args \
      --output-format stream-json --verbose \
      > "$outdir/transcript.jsonl" 2> "$outdir/stderr.log" || claude_failed=1

    # Final assistant text → output.txt. If jq fails (malformed transcript), leave
    # output.txt empty so the Phase 2 existence check skips grading instead of
    # grading an empty string.
    if ! jq -r 'select(.type=="result") | .result // empty' \
        "$outdir/transcript.jsonl" > "$outdir/output.txt" 2> "$outdir/jq-output-err.log"; then
      : > "$outdir/output.txt"
    fi

    # Errors → errors.jsonl (one event per failed tool call, with tool name + input + error text).
    # If jq itself fails (malformed transcript, missing file), emit a synthetic error so the
    # no-errors gate fails loudly instead of reporting a false PASS on an empty file.
    if ! jq -c -s '
      ([.[] | select(.type=="assistant") | .message.content[]? | select(.type=="tool_use")]
        | map({(.id): {name, input}}) | add // {}) as $tools
      | .[] | select(.type=="user") | .message.content[]?
      | select(.type=="tool_result" and .is_error==true)
      | { tool: ($tools[.tool_use_id].name // "unknown"),
          input: ($tools[.tool_use_id].input // null),
          error: .content }
    ' "$outdir/transcript.jsonl" > "$outdir/errors.jsonl" 2> "$outdir/jq-err.log"; then
      printf '%s\n' '{"tool":"jq-extraction","input":null,"error":"errors.jsonl extraction failed — see jq-err.log and transcript.jsonl"}' > "$outdir/errors.jsonl"
    fi

    # If the claude process itself crashed, append a synthetic error so the no-errors
    # gate fails. stderr.log has the underlying reason.
    if [ "$claude_failed" -eq 1 ]; then
      printf '%s\n' '{"tool":"claude-cli","input":null,"error":"agent process exited non-zero — see stderr.log"}' >> "$outdir/errors.jsonl"
    fi

    echo "$eval_id: done"
  ) &
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

  # If output.txt is empty or missing, skip the grader entirely and write a
  # clear synthetic verdict per assertion. Avoids paying for grader calls on
  # an empty string and produces evidence that points at the real failure.
  if [ ! -s "$outdir/output.txt" ]; then
    for j in $(seq 0 $((assertions_count - 1))); do
      printf '%s\n' '{"passed":false,"evidence":"agent output is empty or missing — eval did not complete; see transcript.jsonl and stderr.log"}' > "$tmpdir/grade_${i}_${j}.txt"
    done
    continue
  fi

  output_text=$(cat "$outdir/output.txt")

  for j in $(seq 0 $((assertions_count - 1))); do
    assertion=$(jq -r ".evals[$i].assertions[$j]" "$EVALS_FILE")
    (
      grade_raw=$(claude -p "$(printf 'Output:\n%s\n\nAssertion: "%s"\n\nDoes the output satisfy the assertion? Reply as JSON only: {"passed":true,"evidence":"one sentence"}' "$output_text" "$assertion")" \
        --mcp-config '{"mcpServers":{}}' --strict-mcp-config \
        --output-format text 2> "$tmpdir/grade-stderr_${i}_${j}.log" \
        | sed 's/^```json[[:space:]]*//;s/^```[[:space:]]*//' \
        | tr -d '\n' \
        | grep -o '{.*}' || echo '{"passed":false,"evidence":"grading failed — see grade-stderr log in tmpdir"}')
      echo "$grade_raw" > "$tmpdir/grade_${i}_${j}.txt"
    ) &
  done
done

wait

# Phase 3: aggregate and report in eval order
total_pass=0
total_assertions=0
total_errors=0
clean_runs=0

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

  # Deterministic no-errors check (separate from LLM-graded assertions)
  err_count=$(wc -l < "$outdir/errors.jsonl" 2>/dev/null | tr -d ' ')
  err_count=${err_count:-0}
  if [ "$err_count" -eq 0 ]; then
    err_result="PASS"
    clean_runs=$((clean_runs + 1))
  else
    err_result="FAIL"
  fi
  printf "  %s  no-errors check: %d failed tool call(s)\n" "$err_result" "$err_count"

  total_pass=$((total_pass + eval_pass))
  total_assertions=$((total_assertions + assertions_count))
  total_errors=$((total_errors + err_count))
  echo "  Score: $eval_pass/$assertions_count assertions, $err_count errors"
  echo ""
done

# Per-eval error summary — first error per eval, one line each
echo "=== Error summary ==="
any_errors=0
for i in $(seq 0 $((count - 1))); do
  eval_id=$(jq -r ".evals[$i].id" "$EVALS_FILE")
  outdir="${WORKSPACE}/${eval_id}"
  err_count=$(wc -l < "$outdir/errors.jsonl" 2>/dev/null | tr -d ' ')
  err_count=${err_count:-0}
  [ "$err_count" -eq 0 ] && continue
  any_errors=1
  # Show only the first error per eval — the full list is in errors.jsonl
  line=$(head -n 1 "$outdir/errors.jsonl")
  tool=$(echo "$line" | jq -r '.tool')
  msg=$(echo "$line" | jq -r 'if (.error|type)=="string" then .error else (.error|tostring) end' | tr '\n' ' ' | cut -c1-100)
  printf "  %-20s %-12s %s\n" "$eval_id" "$tool" "$msg"
done
[ "$any_errors" -eq 0 ] && echo "  (no errors across any eval)"
echo ""

rm -rf "$tmpdir"
echo "=== Total: $total_pass/$total_assertions assertions passed, $clean_runs/$count clean runs, $total_errors errors ==="
echo "Results in $WORKSPACE/"
