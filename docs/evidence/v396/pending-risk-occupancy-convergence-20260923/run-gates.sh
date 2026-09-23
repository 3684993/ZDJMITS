#!/usr/bin/env bash
# Offline gate battery for the pending-risk occupancy convergence round.
# Nothing here may write the live dist: the running Engine serves apps/engine/dist and
# apps/dashboard/dist from disk, so builds go to the isolated build-check/ tree and are removed after.
set -u
ROOT=/d/MITS-WORKTREES/v396-final-convergence-20260922
OUT=$ROOT/docs/evidence/v396/pending-risk-occupancy-convergence-20260923/gates
mkdir -p "$OUT"
: > "$OUT/exit-codes.txt"
run() {
  local name="$1"; shift
  ( "$@" ) > "$OUT/$name.txt" 2>&1
  local code=$?
  echo "$name=$code" >> "$OUT/exit-codes.txt"
  echo "$name=$code"
}
cd "$ROOT" || exit 1
run verify-deps           bash -c "npm run build -w @zdj/contracts && npm run build -w @zdj/core"
run s00-static            node scripts/v396-s00-static-check.mjs
run storage-coverage      node scripts/v396-storage-coverage.mjs --check
cd "$ROOT/apps/engine" || exit 1
run engine-affected-tests npx vitest run src/services/pendingRiskOccupancyConvergence.test.ts src/services/j2PortfolioAdmissionHostile.test.ts src/services/finalRiskConvergence.test.ts src/services/s05PortfolioTailRisk.test.ts src/services/grossRiskCapacityVisibility.test.ts src/services/executionReadiness.test.ts --reporter=basic
run engine-typecheck      npx tsc -p tsconfig.json --noEmit
run engine-tests          npx vitest run --reporter=basic
run engine-build-check    npx tsc -p tsconfig.json --outDir ../../build-check/engine
cd "$ROOT/packages/core" || exit 1
run core-typecheck        npx tsc -p tsconfig.json --noEmit
run core-tests            npx vitest run --reporter=basic
cd "$ROOT/packages/contracts" || exit 1
run contracts-typecheck   npx tsc -p tsconfig.json --noEmit
run contracts-tests       npx vitest run --passWithNoTests --reporter=basic
cd "$ROOT" || exit 1
run git-diff-check        git diff --check
echo DONE
