/** Sampling never holds an Entry promise or queues behind a model resource. These are upper
 * bounds on attempted observations, not an assertion that a separate Scout backend is available. */
export const SCOUT_OBSERVATION_POLICY = Object.freeze({ everyCompletedPrimary: 10, minIntervalMs: 300_000, maxInFlight: 1 });

export class ScoutObservationSampler {
  private completedPrimary = 0;
  private lastAttemptAt: number | null = null;
  private inFlight = false;

  tryReserve(now = Date.now()): { sampled: boolean; reason: string; completedPrimary: number } {
    this.completedPrimary++;
    const result = (sampled: boolean, reason: string) => ({ sampled, reason, completedPrimary: this.completedPrimary });
    if (this.completedPrimary % SCOUT_OBSERVATION_POLICY.everyCompletedPrimary !== 0) return result(false, 'NOT_SAMPLED');
    if (this.inFlight) return result(false, 'OBSERVER_IN_FLIGHT');
    if (this.lastAttemptAt !== null && now - this.lastAttemptAt < SCOUT_OBSERVATION_POLICY.minIntervalMs) return result(false, 'SAMPLE_INTERVAL');
    this.lastAttemptAt = now;
    this.inFlight = true;
    return result(true, 'SAMPLED');
  }

  release() { this.inFlight = false; }
}
