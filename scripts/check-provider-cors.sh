#!/usr/bin/env bash
# CORS diagnostic for browser-only LLM providers (macOS / Linux).
#
# Usage (no sudo needed):
#   ./scripts/check-provider-cors.sh
#   ./scripts/check-provider-cors.sh 'https://gpu1-llm.emofid.com'
#   ORIGIN='https://sadeghhp.github.io' API_KEY='sk-...' ./scripts/check-provider-cors.sh 'https://gpu1-llm.emofid.com'
#   TEST_MODEL='my-model' API_KEY='sk-...' ./scripts/check-provider-cors.sh 'https://gpu1-llm.emofid.com'
#
# Paste the full output when asking for help. API keys are never printed in full.

set -euo pipefail

BASE_URL="${1:-${BASE_URL:-https://gpu1-llm.emofid.com}}"
ORIGIN="${ORIGIN:-https://sadeghhp.github.io}"
API_KEY="${API_KEY:-}"
MODELS_PATH="${MODELS_PATH:-/v1/models}"
CHAT_PATH="${CHAT_PATH:-/v1/chat/completions}"
TEST_MODEL="${TEST_MODEL:-}"
CONNECT_TIMEOUT="${CONNECT_TIMEOUT:-10}"
MAX_TIME="${MAX_TIME:-30}"

BASE_URL="${BASE_URL%/}"

pass() { printf '  [PASS] %s\n' "$1"; }
fail() { printf '  [FAIL] %s\n' "$1"; }
info() { printf '  [INFO] %s\n' "$1"; }
section() { printf '\n== %s ==\n' "$1"; }

OVERALL_PASS=0
OVERALL_FAIL=0
CORS_FAIL=0
record() {
  if "$@"; then
    OVERALL_PASS=$((OVERALL_PASS + 1))
  else
    OVERALL_FAIL=$((OVERALL_FAIL + 1))
  fi
}
# Same as record, but failures count toward the CORS verdict.
record_cors() {
  if "$@"; then
    OVERALL_PASS=$((OVERALL_PASS + 1))
  else
    OVERALL_FAIL=$((OVERALL_FAIL + 1))
    CORS_FAIL=$((CORS_FAIL + 1))
  fi
}

mask_key() {
  local k="$1"
  if [[ -z "$k" ]]; then
    echo "(none)"
  elif [[ ${#k} -le 8 ]]; then
    echo "****"
  else
    echo "${k:0:4}...${k: -4} (len ${#k})"
  fi
}

# Headers only (up to first blank line) from `curl -D -` output.
parse_headers() {
  awk 'BEGIN{blank=0} /^HTTP\//{blank=0} blank==0{print} /^$/{blank=1; exit}'
}

header_value() {
  local name="$1"
  awk -v want="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')" '
    {
      line = $0
      sub(/\r$/, "", line)
      split(line, parts, ":")
      key = parts[1]
      # strip leading spaces from value after first colon
      val = substr(line, length(key) + 2)
      sub(/^[[:space:]]+/, "", val)
      if (tolower(key) == want) {
        print val
        exit
      }
    }
  '
}

http_status() {
  printf '%s\n' "$1" | awk '/^HTTP\//{print $2; exit}'
}

check_allow_origin() {
  local value="$1"
  local label="$2"
  if [[ -z "$value" ]]; then
    fail "$label: missing Access-Control-Allow-Origin"
    return 1
  fi
  if [[ "$value" == "*" ]]; then
    pass "$label: Access-Control-Allow-Origin: *"
    return 0
  fi
  if [[ "$value" == "$ORIGIN" ]]; then
    pass "$label: Access-Control-Allow-Origin matches page origin ($ORIGIN)"
    return 0
  fi
  fail "$label: Access-Control-Allow-Origin is '$value' (expected '$ORIGIN' or *)"
  return 1
}

check_header_contains() {
  local headers="$1"
  local header_name="$2"
  local needle="$3"
  local label="$4"
  local value
  value="$(printf '%s\n' "$headers" | header_value "$header_name")"
  if [[ -z "$value" ]]; then
    fail "$label: missing $header_name"
    return 1
  fi
  if printf '%s' "$value" | tr '[:upper:]' '[:lower:]' | grep -Fq "$(printf '%s' "$needle" | tr '[:upper:]' '[:lower:]')"; then
    pass "$label: $header_name includes '$needle' ($value)"
    return 0
  fi
  fail "$label: $header_name='$value' does not include '$needle'"
  return 1
}

# curl that never hangs forever; stdout = headers dump (-D -), body discarded.
run_curl() {
  local method="$1"
  local url="$2"
  shift 2
  curl -sS -D - -o /dev/null \
    --connect-timeout "$CONNECT_TIMEOUT" \
    --max-time "$MAX_TIME" \
    -X "$method" "$url" "$@"
}

# bash 3.2 (macOS) + set -u errors on "${empty_array[@]}".
# Build optional auth as a separate curl invocation path instead.
curl_with_optional_auth() {
  local method="$1"
  local url="$2"
  shift 2
  if [[ -n "$API_KEY" ]]; then
    run_curl "$method" "$url" "$@" -H "Authorization: Bearer $API_KEY"
  else
    run_curl "$method" "$url" "$@"
  fi
}

check_preflight_status() {
  local status="$1"
  local label="$2"
  if [[ "$status" == "200" || "$status" == "204" ]]; then
    pass "$label status: $status"
    return 0
  fi
  if [[ -z "$status" ]]; then
    fail "$label status: no HTTP response (network/DNS/timeout)"
    return 1
  fi
  fail "$label status: $status (expected 200 or 204)"
  return 1
}

# For CORS diagnosis, any HTTP response proves the host answered.
# 401/403 without a key is fine; missing CORS headers is the real failure.
check_reachable_status() {
  local status="$1"
  local label="$2"
  if [[ -z "$status" ]]; then
    fail "$label status: no HTTP response (network/DNS/timeout)"
    return 1
  fi
  if [[ "$status" =~ ^[12345][0-9][0-9]$ ]]; then
    pass "$label status: $status (host reachable)"
    return 0
  fi
  fail "$label status: $status"
  return 1
}

section "Config"
echo "  Base URL:     $BASE_URL"
echo "  Page origin:  $ORIGIN"
echo "  Models path:  $MODELS_PATH"
echo "  Chat path:    $CHAT_PATH"
echo "  API key:      $(mask_key "$API_KEY")"
echo "  Test model:   ${TEST_MODEL:-(skip chat test)}"
echo "  Date:         $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

section "1) OPTIONS preflight — GET $MODELS_PATH"
PREFLIGHT_GET_HEADERS="$(
  run_curl OPTIONS "$BASE_URL$MODELS_PATH" \
    -H "Origin: $ORIGIN" \
    -H "Access-Control-Request-Method: GET" \
    -H "Access-Control-Request-Headers: authorization,content-type" \
    2>&1 | parse_headers || true
)"
printf '%s\n' "$PREFLIGHT_GET_HEADERS" | sed 's/^/    /'

STATUS="$(http_status "$PREFLIGHT_GET_HEADERS")"
record check_preflight_status "$STATUS" "Preflight GET"
AO="$(printf '%s\n' "$PREFLIGHT_GET_HEADERS" | header_value 'Access-Control-Allow-Origin')"
record_cors check_allow_origin "$AO" "Preflight GET"
record_cors check_header_contains "$PREFLIGHT_GET_HEADERS" "Access-Control-Allow-Methods" "GET" "Preflight GET"
record_cors check_header_contains "$PREFLIGHT_GET_HEADERS" "Access-Control-Allow-Headers" "authorization" "Preflight GET"

section "2) GET $MODELS_PATH (with Origin)"
GET_HEADERS="$(
  curl_with_optional_auth GET "$BASE_URL$MODELS_PATH" \
    -H "Origin: $ORIGIN" \
    2>&1 | parse_headers || true
)"
printf '%s\n' "$GET_HEADERS" | sed 's/^/    /'

GET_STATUS="$(http_status "$GET_HEADERS")"
record check_reachable_status "$GET_STATUS" "GET"
GET_AO="$(printf '%s\n' "$GET_HEADERS" | header_value 'Access-Control-Allow-Origin')"
record_cors check_allow_origin "$GET_AO" "GET response"
if [[ -z "$API_KEY" && "$GET_STATUS" == "401" ]]; then
  info "GET returned 401 without API key — expected; CORS still requires Allow-Origin on that response."
fi

section "3) OPTIONS preflight — POST $CHAT_PATH"
PREFLIGHT_POST_HEADERS="$(
  run_curl OPTIONS "$BASE_URL$CHAT_PATH" \
    -H "Origin: $ORIGIN" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: authorization,content-type" \
    2>&1 | parse_headers || true
)"
printf '%s\n' "$PREFLIGHT_POST_HEADERS" | sed 's/^/    /'

POST_STATUS="$(http_status "$PREFLIGHT_POST_HEADERS")"
record check_preflight_status "$POST_STATUS" "Preflight POST"
POST_AO="$(printf '%s\n' "$PREFLIGHT_POST_HEADERS" | header_value 'Access-Control-Allow-Origin')"
record_cors check_allow_origin "$POST_AO" "Preflight POST"
record_cors check_header_contains "$PREFLIGHT_POST_HEADERS" "Access-Control-Allow-Methods" "POST" "Preflight POST"
record_cors check_header_contains "$PREFLIGHT_POST_HEADERS" "Access-Control-Allow-Headers" "authorization" "Preflight POST"
record_cors check_header_contains "$PREFLIGHT_POST_HEADERS" "Access-Control-Allow-Headers" "content-type" "Preflight POST"

if [[ -n "$TEST_MODEL" ]]; then
  section "4) POST $CHAT_PATH smoke test (with Origin)"
  CHAT_BODY="$(printf '{"model":"%s","messages":[{"role":"user","content":"ok"}],"max_tokens":1}' "$TEST_MODEL")"
  CHAT_HEADERS="$(
    curl_with_optional_auth POST "$BASE_URL$CHAT_PATH" \
      -H "Origin: $ORIGIN" \
      -H "Content-Type: application/json" \
      --data "$CHAT_BODY" \
      2>&1 | parse_headers || true
  )"
  printf '%s\n' "$CHAT_HEADERS" | sed 's/^/    /'
  CHAT_STATUS="$(http_status "$CHAT_HEADERS")"
  record check_reachable_status "$CHAT_STATUS" "POST chat"
  CHAT_AO="$(printf '%s\n' "$CHAT_HEADERS" | header_value 'Access-Control-Allow-Origin')"
  record_cors check_allow_origin "$CHAT_AO" "POST chat response"
else
  section "4) POST chat smoke test"
  info "Skipped (set TEST_MODEL=your-model-id to include)"
fi

section "Summary"
TOTAL=$((OVERALL_PASS + OVERALL_FAIL))
echo "  Checks passed: $OVERALL_PASS / $TOTAL"
if [[ "$CORS_FAIL" -eq 0 && "$OVERALL_FAIL" -eq 0 ]]; then
  echo "  Verdict: CORS looks OK for browser use from $ORIGIN"
  echo "  Next: retry Test connection in the GitHub Pages app."
elif [[ "$CORS_FAIL" -eq 0 ]]; then
  echo "  Verdict: CORS headers look OK, but some HTTP status checks failed."
  echo "  Check the [FAIL] lines above (wrong path, auth, or upstream error)."
else
  echo "  Verdict: CORS NOT configured for browser use from $ORIGIN"
  echo "  Fix: add Access-Control-Allow-Origin (and preflight headers) on the provider server."
  echo "  Workaround: use npm run dev locally (dev proxy) until CORS is fixed."
fi
echo ""
echo "Paste everything above when sharing results."
