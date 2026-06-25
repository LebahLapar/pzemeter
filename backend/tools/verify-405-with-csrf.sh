#!/usr/bin/env bash
# Konfirmasi: dengan CSRF token valid, method non-POST (PUT/DELETE/PATCH)
# mencapai guard router dan dibalas 405 (bukan 403). Ini membuktikan guard
# 405 berfungsi; status 403 sebelumnya hanya karena lapisan CSRF global
# memvalidasi method state-changing lebih dulu (default-deny, aman).

BASE="http://localhost:3000"
USER="${ADMIN_USERNAME:-admin}"
PASS="${ADMIN_PASSWORD:-0WjhpCpqQnltgYIQ}"
JAR="/tmp/fr_cookies2.txt"
rm -f "$JAR"

curl -s -c "$JAR" -o /dev/null -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}"

CSRF=$(curl -s -b "$JAR" -c "$JAR" "$BASE/api/auth/me" \
  | sed -n 's/.*"csrfToken":"\([^"]*\)".*/\1/p')

for M in PUT DELETE PATCH; do
  ST=$(curl -s -b "$JAR" -o /tmp/fr_b2.txt -w "%{http_code}" \
    -X "$M" "$BASE/api/factory-reset" -H "X-CSRF-Token: $CSRF")
  printf '%s with valid CSRF -> status=%s body=%s\n' "$M" "$ST" "$(cat /tmp/fr_b2.txt)"
done
