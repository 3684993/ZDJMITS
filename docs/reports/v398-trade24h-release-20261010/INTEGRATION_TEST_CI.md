# Integration validation

Clean independent branch codex/v398-trade24h-final starts at PR34 89a63872ff4f88774a0c556b80be28fe665af260. Merge commits preserve PR31 ae39b390e8d1900c91c76582d3c7ad9166df3386, PR33 402b850f73fd10018fb03db0b5deaeda493dd499, PR32 6ac46f8a93c096b5764bc05508ba47aa015bf381. Documentation conflicts retain all histories; router/client code merges cleanly. No PR25/27/29 network changes are included.

npm ci PASS. Original targeted tests 14/17 passed; all original RED and intermediate logs retained. Final verify:ci exit0 includes dependencies/scripts/release/S00/typecheck/build, contracts2/core63/dashboard138/Engine572+602+409+414 = 2200 passing tests. S00 initially detected intentional merged entrypoint inventory drift; mechanically regenerated 200-entry review and reran the normal gate. No S00 rule removed. See verify-ci-combined-final.log. Targeted identity/UI regression logs are also retained.

Combined exact-source6533e4d hosted CI38025974065 SUCCESS. Full job log and exact head/step metadata archived in github-actions-integration.json and github-ci-integration-38025974065-success.log. Individual PR greens were not substituted. Actual main promotion and lifecycle occurred only after this CI and fresh gates; see CONTROLLED_DEPLOY_RECEIPT.md. Subsequent closeout commits modify evidence/docs only; deployed runtime stays frozen at6533e4d.

PR33 borrow is default OFF; reasoner/output mismatch is not relaxed and no live cross-GPU Primary routing enabled. PR32 is TP_SHADOW only with no real TP execution provider. Primary remains the sole Entry authority.
