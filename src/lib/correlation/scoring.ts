import type { SignalResult } from "./signals";

// ═══════════════════════════════════════════════════════════════════════════
// Noisy-OR Scoring
// P = 1 - Π(1 - effectiveWeight_i)
// Key property: 0.3 + 0.3 ≠ 0.6, instead: 1 - (1-0.3)(1-0.3) = 0.51
// ═══════════════════════════════════════════════════════════════════════════

export interface ScoringResult {
  score: number;
  signals: SignalResult[];
  breakdown: Record<string, number>;
  decision: "merge" | "review" | "ignore";
}

export const THRESHOLDS = {
  MERGE: 0.7, // P ≥ 0.7 → atomic merge into Campaign
  REVIEW: 0.4, // 0.4 ≤ P < 0.7 → human review
  // P < 0.4 → ignore
} as const;

/** Noisy-OR combination: P = 1 - Π(1 - w_i) */
export function noisyOR(weights: number[]): number {
  if (weights.length === 0) return 0;
  let product = 1;
  for (const w of weights) {
    product *= 1 - Math.min(w, 1);
  }
  return 1 - product;
}

/** Score signals and determine decision */
export function scoreSignals(signals: SignalResult[]): ScoringResult {
  const effectiveWeights = signals
    .filter((s) => s.matched)
    .map((s) => s.effectiveWeight);
  const score = noisyOR(effectiveWeights);

  let decision: "merge" | "review" | "ignore";
  if (score >= THRESHOLDS.MERGE) {
    decision = "merge";
  } else if (score >= THRESHOLDS.REVIEW) {
    decision = "review";
  } else {
    decision = "ignore";
  }

  const breakdown: Record<string, number> = {};
  for (const signal of signals) {
    breakdown[signal.signalId] = signal.effectiveWeight;
  }

  return { score, signals, breakdown, decision };
}

/** Human-readable explanation of a scoring result */
export function explainScore(result: ScoringResult): string {
  const lines: string[] = [
    `Combined score: ${result.score.toFixed(4)} (decision: ${result.decision})`,
    `Thresholds: merge≥${THRESHOLDS.MERGE}, review≥${THRESHOLDS.REVIEW}`,
    "",
    "Signal breakdown:",
  ];
  for (const signal of result.signals) {
    const status = signal.matched ? "✓" : "✗";
    lines.push(
      `  ${status} ${signal.signalId}: effectiveWeight=${signal.effectiveWeight.toFixed(4)} ` +
        `(weight=${signal.weight}, temporalFactor=${signal.temporalFactor.toFixed(4)}) — ${signal.details}`
    );
  }
  return lines.join("\n");
}
