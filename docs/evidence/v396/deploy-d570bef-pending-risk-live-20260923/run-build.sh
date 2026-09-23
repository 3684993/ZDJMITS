#!/usr/bin/env bash
# Formal build for the authorised deploy round: contracts + core + engine dist + dashboard dist.
# The live Engine is still running during this step by plan order (build -> stop -> start), so the
# dashboard assets it serves per request change a few minutes before the process is swapped.
set -u
ROOT=/d/MITS-WORKTREES/v396-final-convergence-20260922
OUT=$ROOT/docs/evidence/v396/deploy-d570bef-pending-risk-live-20260923
cd "$ROOT" || exit 1
: > "$OUT/build-exit-codes.txt"
run() { local n="$1"; shift; ( "$@" ) > "$OUT/$n.txt" 2>&1; local c=$?; echo "$n=$c" >> "$OUT/build-exit-codes.txt"; echo "$n=$c"; return $c; }
run build-01-verify-deps bash -c "npm run build -w @zdj/contracts && npm run build -w @zdj/core"
run build-02-engine bash -c "npm run build -w @zdj/engine"
run build-03-dashboard bash -c "npm run build -w @zdj/dashboard"
node --input-type=module -e "
const {contentTreeHash}=await import('file:///D:/MITS-WORKTREES/v396-final-convergence-20260922/apps/engine/dist/runtime/runtimeIdentity.js');
const root='D:/MITS-WORKTREES/v396-final-convergence-20260922';
const artifactHash=await contentTreeHash(root,['apps/engine/dist','packages/core/dist','packages/contracts/dist','apps/dashboard/dist']);
const sourceHash=await contentTreeHash(root,['apps/engine/src','packages/core/src','packages/contracts/src','apps/dashboard/src']);
console.log(JSON.stringify({expectedBuildId:'3.9.6-'+artifactHash.slice(0,20),artifactHash,sourceHash},null,2));
" > "$OUT/build-04-expected-artifact-identity.json" 2>&1
cat "$OUT/build-04-expected-artifact-identity.json"
echo BUILD_DONE
