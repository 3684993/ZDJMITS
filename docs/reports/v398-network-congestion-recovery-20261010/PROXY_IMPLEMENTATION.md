# PR41 proxy lifecycle repair

Original head f1f5d9c7863d6be3f6aef1a451a4cb90a556ea1d had conflicting handoff/memory documentation. Both histories were retained while merging current main; merged PR42 source is now included.

Confirmed defects repaired: periodic/multiple cockpit callers could repeatedly create fresh probes immediately after single-flight completion; a one-shot restart stopped the guardian without restoring it; the rolling fifteen-minute restart budget could replenish indefinitely during an unchanged fault.

Verification now keeps the original evidence timestamp, applies thirty-second probe cooldown and bounded exponential failure backoff, restores an identity-checked hidden guardian after a one-shot operation (including failed initial health), and limits each guardian lifetime to at most two cooled restarts. There is no Engine or exchange lifecycle authority in these proxy controls. Existing process creation time, executable, bind, route and key-path checks remain required before signaling an owner.

Local npm ci, focused 25 Engine tests and script regression, complete verify:ci including S00 passed before integration. Integrated verification incorporating PR42 is recorded separately in proxy-integrated-verify-ci.log. Fresh final-head GitHub CI is required; the historical green runs do not certify the changed head.

At implementation time existing SSH PID12212 remains running, no restart has been executed, and guardian absence is confirmed by record/process inventory. Deployment and actual guardian restoration remain pending precise-head CI. Healthy Qwen models were not restarted. Engine remains offline pending fresh signed protection proof and reviewed release identity.
