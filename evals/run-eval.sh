#!/bin/bash
# Usage: bash evals/run-eval.sh evals/train_queries.json
#        bash evals/run-eval.sh evals/validation_queries.json
#
# Runs each query through claude -p and checks whether the agent invoked
# the agent-payments skill. Each query runs RUNS times; a should-trigger
# query passes if triggered ≥2/3 times, a should-not-trigger if triggered ≤1/3.
#
# Prerequisites:
#   1. claude CLI must be available (Claude Code)
#   2. jq must be installed
#   3. The skill must be discoverable:
#      ln -s <repo>/agent-payments ~/.claude/skills/agent-payments

QUERIES_FILE="${1:?Usage: $0 <queries.json>}"
SKILL_NAME="agent-payments"
RUNS=3

check_triggered() {
  local query="$1"
  claude -p "$query" --output-format json 2>/dev/null \
    | jq -e --arg skill "$SKILL_NAME" \
      'any(.messages[].content[]; .type == "tool_use" and .name == "Skill" and .input.skill == $skill)' \
      > /dev/null 2>&1
}

count=$(jq length "$QUERIES_FILE")
pass=0
fail=0

echo "Running $count queries × $RUNS runs against skill: $SKILL_NAME"
echo "Queries file: $QUERIES_FILE"
echo ""

for i in $(seq 0 $((count - 1))); do
  query=$(jq -r ".[$i].query" "$QUERIES_FILE")
  should_trigger=$(jq -r ".[$i].should_trigger" "$QUERIES_FILE")
  triggers=0

  for run in $(seq 1 $RUNS); do
    check_triggered "$query" && triggers=$((triggers + 1))
  done

  rate=$(echo "scale=2; $triggers / $RUNS" | bc)

  if [ "$should_trigger" = "true" ]; then
    [ "$triggers" -ge 2 ] && result="PASS" || result="FAIL"
  else
    [ "$triggers" -le 1 ] && result="PASS" || result="FAIL"
  fi

  [ "$result" = "PASS" ] && pass=$((pass + 1)) || fail=$((fail + 1))

  printf "%s  rate=%.2f  should=%-5s  \"%s\"\n" "$result" "$rate" "$should_trigger" "${query:0:70}"
done

echo ""
echo "Score: $pass/$((pass + fail)) passed"
