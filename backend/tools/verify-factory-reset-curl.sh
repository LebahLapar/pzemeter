#!/usr/bin/env bash
# Verifikasi endpoint POST /api/factory-reset via curl (Task 9.1).
# Menguji: 405 method non-POST, 401 tanpa sesi, 403 sesi valid tanpa CSRF,
# 200 sukses dengan deletedCount.
# Tidak memakai set -e agar semua test tetap berjalan walau satu gagal.

BASE="http://localhost:3000"
USER="${ADMIN_USERNAME:-admin}"
PASS="${ADMIN_PASSWORD:-0WjhpCpqQnltgYIQ}"
JAR="/tmp/fr_cookies.txt"
rm -f "$JAR"

pass=0
fail=0

check() {
  # args: label expected actual_status body
  local label="$1" expected="$2" actual="$3" body="$4"
  if [ "$actual" = "$expected" ]; then
    echo "PASS | $label | expected=$expected got=$actual | body=$body"
    pass=$((pass+1))
  else
    echo "FAIL | $label | expected=$expected got=$actual | body=$body"
    fail=$((fail+1))
  fi
}

echo "===================================================================="
echo "Factory Reset endpoint verification (curl)"
echo "===================================================================="

# ---- TEST A: 401 POST tanpa sesi ----
ST=$(curl -s -o /tmp/fr_b.txt -w "%{http_code}" -X POST "$BASE/api/factory-reset")
check "401 POST tanpa sesi" "401" "$ST" "$(cat /tmp/fr_b.txt)"

# ---- Login untuk dapat sesi + CSRF ----
echo "--- login sebagai '$USER' ---"
LOGIN_ST=$(curl -s -c "$JAR" -o /tmp/fr_login.txt -w "%{http_code}" \
  -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}")
echo "login_status=$LOGIN_ST body=$(cat /tmp/fr_login.txt)"

# ---- Ambil CSRF token via /api/auth/me (set cookie csrf + balas token) ----
CSRF=$(curl -s -b "$JAR" -c "$JAR" "$BASE/api/auth/me" \
  | sed -n 's/.*"csrfToken":"\([^"]*\)".*/\1/p')
echo "csrf_token_present=$([ -n "$CSRF" ] && echo yes || echo no)"

# ---- TEST B: 405 GET dengan sesi valid (lolos auth, kena guard 405) ----
ST=$(curl -s -b "$JAR" -o /tmp/fr_b.txt -w "%{http_code}" -X GET "$BASE/api/factory-reset")
check "405 GET (sesi valid)" "405" "$ST" "$(cat /tmp/fr_b.txt)"

ST=$(curl -s -b "$JAR" -o /tmp/fr_b.txt -w "%{http_code}" -X PUT "$BASE/api/factory-reset")
check "405 PUT (sesi valid)" "405" "$ST" "$(cat /tmp/fr_b.txt)"

ST=$(curl -s -b "$JAR" -o /tmp/fr_b.txt -w "%{http_code}" -X DELETE "$BASE/api/factory-reset")
check "405 DELETE (sesi valid)" "405" "$ST" "$(cat /tmp/fr_b.txt)"

ST=$(curl -s -b "$JAR" -o /tmp/fr_b.txt -w "%{http_code}" -X PATCH "$BASE/api/factory-reset")
check "405 PATCH (sesi valid)" "405" "$ST" "$(cat /tmp/fr_b.txt)"

# ---- TEST C: 403 POST sesi valid TANPA CSRF token ----
ST=$(curl -s -b "$JAR" -o /tmp/fr_b.txt -w "%{http_code}" -X POST "$BASE/api/factory-reset")
check "403 POST sesi valid tanpa CSRF" "403" "$ST" "$(cat /tmp/fr_b.txt)"

# ---- TEST D: 200 POST sesi valid + CSRF token valid ----
ST=$(curl -s -b "$JAR" -c "$JAR" -o /tmp/fr_b.txt -w "%{http_code}" \
  -X POST "$BASE/api/factory-reset" \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF")
BODY="$(cat /tmp/fr_b.txt)"
check "200 POST sesi valid + CSRF" "200" "$ST" "$BODY"

# Verifikasi body sukses memuat ok:true dan deletedCount
echo "$BODY" | grep -q '"ok":true' && echo "PASS | body memuat ok:true" || { echo "FAIL | body tidak memuat ok:true"; fail=$((fail+1)); }
echo "$BODY" | grep -q '"deletedCount"' && echo "PASS | body memuat deletedCount" || { echo "FAIL | body tidak memuat deletedCount"; fail=$((fail+1)); }

echo "===================================================================="
echo "RESULT: pass=$pass fail=$fail"
echo "===================================================================="
exit 0
