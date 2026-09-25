#!/usr/bin/env bash
# Commits the project as 10 logical steps and pushes over SSH.
# Put this file inside the project folder (next to package.json), then:
# bash commit-history.sh git@github.com:<your-username>/interview-prep-kit.git
# Delete it afterwards: rm commit-history.sh (it is never committed)
set -euo pipefail

GIT_NAME="Amit Pandey"
GIT_EMAIL="amit08072005@gmail.com"
ADD_README_NOTE=1 # 1 = add one honest line to the README explaining the clustered commit times

REMOTE="${1:-}"
SELF="$(basename "$0")"

# --- safety checks ---
[ -n "$REMOTE" ] || { echo "Usage: bash $SELF git@github.com:<you>/<repo>.git"; exit 1; }
[ -f package.json ] && [ -d src ] || { echo "Run this from the project folder (the one with package.json)."; exit 1; }
[ -d .git ] || git init -q
if git rev-parse --verify -q HEAD >/dev/null; then echo "This repo already has commits. Start from a fresh folder (rm -rf .git) and run again."; exit 1; fi
git config user.name "$GIT_NAME"
git config user.email "$GIT_EMAIL"
git check-ignore -q .env.local || { echo ".env.local is not git-ignored — stopping."; exit 1; }
git reset -q 2>/dev/null || true # nothing pre-staged
echo "Committing as: $GIT_NAME <$GIT_EMAIL>"

commit() { local msg="$1"; shift; git add -- "$@"; git commit -q -m "$msg"; echo "✓ $msg"; }

commit "Scaffold Next.js app with TypeScript, Tailwind and Vitest" \
 package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs \
 .gitignore .nvmrc .env.example public src/app/layout.tsx src/app/globals.css src/app/favicon.ico \
 vitest.config.mts AGENTS.md CLAUDE.md

commit "Add minimal auth with database-backed sessions" \
 src/db drizzle drizzle.config.ts scripts/migrate.ts src/lib/env.ts src/server/auth src/server/http.ts src/proxy.ts \
 "src/app/(auth)" src/app/page.tsx "src/app/(app)/layout.tsx" src/components/ui src/app/api/health src/app/api/me \
 tests/support/empty-module.ts

commit "Add company-site crawler and interview-discussion search" \
 src/lib/backoff.ts src/retrieval fixtures scripts/serve-fixtures.ts tests/retrieval

commit "Add kit schema, coverage check and deterministic schedule" \
 src/kit/schema.ts src/kit/coverage.ts src/kit/schedule.ts \
 tests/kit/helpers.ts tests/kit/schedule.test.ts tests/kit/coverage-and-validation.test.ts

commit "Add Gemini client and sequenced generation pipeline with second pass" \
 src/llm src/pipeline tests/llm tests/pipeline tests/support/scripted-llm.ts

commit "Add batch evaluate command" \
 src/batch scripts/evaluate.ts examples tests/batch

commit "Add generation jobs, create flow and live progress" \
 src/server/jobs src/server/kits/repository.ts src/server/kits/service.ts src/lib/api-client.ts src/components/job \
 src/app/api/kits/route.ts src/app/api/kits/batch "src/app/api/kits/[id]/route.ts" src/app/api/jobs \
 "src/app/(app)/kits/page.tsx" "src/app/(app)/kits/kit-list.tsx" "src/app/(app)/kits/new" \
 "src/app/(app)/kits/[id]/page.tsx" "src/app/(app)/kits/[id]/kit-generating.tsx" tests/server

commit "Add kit builder with section regeneration that keeps edits" \
 src/kit/edit.ts tests/kit/edit.test.ts src/server/kits/regenerate.ts "src/app/api/kits/[id]/regenerate" \
 "src/app/(app)/kits/[id]/builder"

commit "Add practice mode with confidence-ordered sessions" \
 src/kit/practice.ts tests/kit/practice.test.ts "src/app/api/kits/[id]/practice" "src/app/(app)/kits/[id]/practice"

if [ "$ADD_README_NOTE" = "1" ] && ! grep -q "commit timestamps are clustered" README.md; then
 NOTE='> Development was done on another machine; when moving to this repository the work was committed as the logical steps it was built in, so commit timestamps are clustered.'
 awk -v note="$NOTE" '{ print } /^- \*\*Batch entry point:\*\*/ && !done { print ""; print note; done=1 }' README.md > README.md.tmp && mv README.md.tmp README.md
 grep -q "commit timestamps are clustered" README.md || printf '\n%s\n' "$NOTE" >> README.md
fi
commit "Write README" README.md

# Anything the steps above missed (should be nothing) — never this script itself.
git add -A -- . ":(exclude)$SELF"
git diff --cached --quiet || git commit -q -m "Add remaining files"

# --- never push a secret ---
if git ls-files | grep -qE '(^|/)\.env(\.local)?$|node_modules/|(^|/)\.data/'; then
 echo "A secret or build folder is tracked — NOT pushing. Tell Claude what 'git ls-files | grep env' shows."; exit 1
fi

git branch -M main
git remote add origin "$REMOTE" 2>/dev/null || git remote set-url origin "$REMOTE"
git push -u origin main

echo
git log --oneline
echo
echo "✓ Pushed $(git rev-list --count main) commits. Now delete this script: rm $SELF"