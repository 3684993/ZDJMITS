/** TESTNET execution policy: portfolio/history risk is observational, never Entry authority.
 * Exact environment AND write-mode matching prevents this policy reaching Production or unlocking READ_ONLY.
 */
export function testnetFundsOnlyEntry(settings: {connections?: {executionMode?: string; exchange?: {environment?: string}}} | null | undefined): boolean {
  return settings?.connections?.exchange?.environment === 'TESTNET' && settings.connections.executionMode === 'TESTNET_ENABLED';
}
