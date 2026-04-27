#!/bin/bash
# Usage: bash evals/run-eval.sh evals/train_queries.json
#        bash evals/run-eval.sh evals/validation_queries.json
#
# All queries and all runs execute in parallel. Each individual call uses early
# termination: the claude process is killed as soon as the Skill event appears
# in the stream (or finishes naturally if the skill doesn't trigger).
#
# Prerequisites:
#   1. claude CLI must be available (Claude Code)
#   2. jq must be installed
#   3. The skill must be symlinked: ln -s <repo>/x402-pay ~/.claude/skills/x402-pay

QUERIES_FILE="${1:?Usage: $0 <queries.json>}"
SKILL_NAME="x402-pay"
RUNS=3

check_triggered() {
  local query="$1"
  # --strict-mcp-config with empty config skips all MCP server startups (the main source of latency).
  # --verbose is required for stream-json in print mode.
  # grep -q exits on first match and sends SIGPIPE to kill claude immediately —
  # no need to wait for the full session once we know whether the skill fired.
  claude -p "$query" \
    --verbose --output-format stream-json \
    --mcp-config '{"mcpServers":{}}' --strict-mcp-config \
    2>/dev/null \
    | grep -q "\"skill\":\"${SKILL_NAME}\""
}

count=$(jq length "$QUERIES_FILE")
tmpdir=$(mktemp -d)

echo "Running $count queries × $RUNS runs in parallel against skill: $SKILL_NAME"
echo "Queries file: $QUERIES_FILE"
echo ""

# Launch all runs for all queries in parallel, each writing to its own temp file
for i in $(seq 0 $((count - 1))); do
  query=$(jq -r ".[$i].query" "$QUERIES_FILE")
  should_trigger=$(jq -r ".[$i].should_trigger" "$QUERIES_FILE")
  for run in $(seq 1 $RUNS); do
    (
      check_triggered "$query" && echo 1 || echo 0
    ) > "$tmpdir/q${i}_r${run}.txt" &
  done
done

wait

# Aggregate and display results in query order
pass=0; fail=0
for i in $(seq 0 $((count - 1))); do
  query=$(jq -r ".[$i].query" "$QUERIES_FILE")
  should_trigger=$(jq -r ".[$i].should_trigger" "$QUERIES_FILE")

  triggers=0
  for run in $(seq 1 $RUNS); do
    val=$(cat "$tmpdir/q${i}_r${run}.txt" 2>/dev/null)
    [ "$val" = "1" ] && triggers=$((triggers + 1))
  done

  rate=$(awk "BEGIN { printf \"%.2f\", $triggers / $RUNS }")
  if [ "$should_trigger" = "true" ]; then
    [ "$triggers" -ge 2 ] && result="PASS" || result="FAIL"
  else
    [ "$triggers" -le 1 ] && result="PASS" || result="FAIL"
  fi
  [ "$result" = "PASS" ] && pass=$((pass + 1)) || fail=$((fail + 1))

  printf "%s  rate=%.2f  should=%-5s  \"%s\"\n" "$result" "$rate" "$should_trigger" "${query:0:70}"
done

rm -rf "$tmpdir"
echo ""
echo "Score: $pass/$((pass + fail)) passed"
