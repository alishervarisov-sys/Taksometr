import {CourierCandidate, DispatchConfig} from "./contracts";

export function calculateScore(candidate: Omit<CourierCandidate, "score">, config: DispatchConfig): number {
  return candidate.etaSeconds * config.etaWeight +
    candidate.distanceMeters * config.distanceWeight +
    candidate.activeOrders * config.courierLoadWeight -
    candidate.idleTimeSeconds * config.idleTimeWeight;
}

/** Stable randomised tie breaker avoids repeatedly favouring an ID or a few metres. */
export function sortCandidates(candidates: CourierCandidate[]): CourierCandidate[] {
  return [...candidates].sort((left, right) => {
    const difference = left.score - right.score;
    if (Math.abs(difference) > 0.01) return difference;
    if (left.idleTimeSeconds !== right.idleTimeSeconds) return right.idleTimeSeconds - left.idleTimeSeconds;
    return left.id.localeCompare(right.id);
  });
}
