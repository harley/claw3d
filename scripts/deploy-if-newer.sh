#!/usr/bin/env bash
# Print current=true when the given commit should deploy: the live BUILD_COMMIT
# is unknown, or this commit is not already contained in it. Prints current=false
# when the live build already includes this commit (equal or newer).
set -euo pipefail
sha="$1"
live=$(railway variable list --project "$RAILWAY_PROJECT_ID" --environment "$RAILWAY_ENVIRONMENT_ID" --service "$RAILWAY_SERVICE_ID" --json 2>/dev/null \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).BUILD_COMMIT||'')}catch{console.log('')}})")
if [ -z "$live" ]; then echo "Live build unknown; deploying $sha." >&2; echo current=true; exit 0; fi
if git cat-file -e "$live^{commit}" 2>/dev/null && git merge-base --is-ancestor "$sha" "$live"; then
  echo "Live build $live already contains $sha; skipping." >&2
  echo "Skipped $sha: live build $live already contains it." >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  echo current=false
else
  echo "Live build is $live; $sha is newer. Deploying." >&2
  echo current=true
fi
