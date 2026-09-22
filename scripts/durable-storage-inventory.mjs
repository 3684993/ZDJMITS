/**
 * S08: the durable files an Engine deployment must be able to back up and restore.
 *
 * This lives in its own module because importing the preflight tool runs it: the list has to be
 * readable by the coverage report without executing a pre-deploy check as a side effect.
 */
export const DURABLE_SQLITE = ['zdj-settings.sqlite', 'v396-ownership.sqlite'];
export const DURABLE_RESTORE_PROOF = 'per-table row counts of the backup must equal the source';
