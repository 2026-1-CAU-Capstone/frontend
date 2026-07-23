#!/usr/bin/env bash
# Jazzify 문서서버 업로더 — front-matter .md → POST /documents/new (or edit)
# usage: JAZZIFY_DOCS_ID=.. JAZZIFY_DOCS_PW=.. scripts/doc-upload.sh <file.md> [docId]
set -euo pipefail
BASE="https://doc.jazzify.p-e.kr"; J=$(mktemp); BODY=$(mktemp); FILE="$1"; DOCID="${2:-}"
typeid(){ case "$1" in "AI 문서") echo 1;; "기술 정리") echo 2;; "기능 명세") echo 4;; "백엔드 요구사항") echo 5;; *) echo 3;; esac; }
teamid(){ case "$1" in 백엔드) echo 1;; 프론트) echo 2;; AI) echo 3;; OMR) echo 4;; *) echo "";; esac; }
fm(){ sed -n "s/^$1:[[:space:]]*//p" "$FILE" | head -1; }
title=$(fm title); typeId=$(typeid "$(fm type)")
targets=$(fm targets | tr -d '[]' | tr ',' ' ')
awk 'f{print} /^---$/{c++; if(c==2) f=1}' "$FILE" > "$BODY"   # front-matter 제거한 본문 → 파일
getcsrf(){ curl -sL -c "$J" -b "$J" "$1" | grep -oE 'name="_csrf"[^>]*value="[^"]+"' | grep -oE 'value="[^"]+"' | head -1 | sed 's/value="//;s/"//'; }
c1=$(getcsrf "$BASE/auth/login")
curl -s -c "$J" -b "$J" -o /dev/null --data-urlencode "email=$JAZZIFY_DOCS_ID" \
  --data-urlencode "password=$JAZZIFY_DOCS_PW" --data-urlencode "_csrf=$c1" "$BASE/auth/login"
URL="$BASE/documents/new"; [ -n "$DOCID" ] && URL="$BASE/documents/$DOCID/edit"
c2=$(getcsrf "$URL")
args=(-F "title=$title" -F "documentTypeId=$typeId" -F "markdownContent=<$BODY")
for t in $targets; do tid=$(teamid "$t"); [ -n "$tid" ] && args+=(-F "targetTeamIds=$tid"); done
curl -s -b "$J" -c "$J" -H "X-CSRF-TOKEN: $c2" "${args[@]}" -o /dev/null -D - "$URL" | grep -iE "^HTTP|^location:"
