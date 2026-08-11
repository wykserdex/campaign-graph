import { describe, it, expect } from "vitest";
import { noisyOR, scoreSignals, THRESHOLDS } from "@/lib/correlation/scoring";
import type { SignalResult } from "@/lib/correlation/signals";

describe("noisyOR", () => {
  it("returns 0 for empty weights", () => {
    expect(noisyOR([])).toBe(0);
  });

  it("returns 0 for all-zero weights", () => {
    expect(noisyOR([0, 0, 0])).toBe(0);
  });

  it("returns 1 for a weight of 1", () => {
    expect(noisyOR([1])).toBe(1);
  });

  it("correctly combines two partial weights (0.3 + 0.3 = 0.51)", () => {
    const result = noisyOR([0.3, 0.3]);
    expect(result).toBeCloseTo(0.51, 4);
  });

  it("correctly combines three weights", () => {
    // 1 - (1-0.3)(1-0.3)(1-0.3) = 1 - 0.343 = 0.657
    const result = noisyOR([0.3, 0.3, 0.3]);
    expect(result).toBeCloseTo(0.657, 3);
  });

  it("clamps weights to 1", () => {
    const result = noisyOR([1.5, 0.5]);
    // 1 - (1-1)(1-0.5) = 1 - 0 = 1
    expect(result).toBe(1);
  });
});

describe("scoreSignals", () => {
  const makeSignal = (
    signalId: string,
    effectiveWeight: number,
    matched: boolean
  ): SignalResult => ({
    signalId,
    weight: effectiveWeight,
    temporalFactor: 1.0,
    effectiveWeight,
    matched,
    details: matched ? `Signal ${signalId} matched` : `Signal ${signalId} not matched`,
  });

  it("returns 'merge' for score >= 0.7", () => {
    const signals = [
      makeSignal("S1", 1.0, true),
      makeSignal("S2", 0, false),
      makeSignal("S3", 0, false),
      makeSignal("S4", 0, false),
      makeSignal("S5", 0, false),
    ];
    const result = scoreSignals(signals);
    expect(result.decision).toBe("merge");
    expect(result.score).toBeCloseTo(1.0, 4);
  });

  it("returns 'review' for score between 0.4 and 0.7", () => {
    const signals = [
      makeSignal("S1", 0, false),
      makeSignal("S2", 0.5, true),
      makeSignal("S3", 0, false),
      makeSignal("S4", 0, false),
      makeSignal("S5", 0, false),
    ];
    const result = scoreSignals(signals);
    expect(result.decision).toBe("review");
    expect(result.score).toBeCloseTo(0.5, 4);
  });

  it("returns 'ignore' for score < 0.4", () => {
    const signals = [
      makeSignal("S1", 0, false),
      makeSignal("S2", 0, false),
      makeSignal("S3", 0, false),
      makeSignal("S4", 0.3, true),
      makeSignal("S5", 0, false),
    ];
    const result = scoreSignals(signals);
    expect(result.decision).toBe("ignore");
    expect(result.score).toBeCloseTo(0.3, 4);
  });

  it("populates breakdown for all signals", () => {
    const signals = [
      makeSignal("S1", 0.5, true),
      makeSignal("S2", 0, false),
    ];
    const result = scoreSignals(signals);
    expect(result.breakdown).toEqual({ S1: 0.5, S2: 0 });
  });

  // §5.3 regression: noisy-OR key correctness property
  it("§5.3: two 0.3 signals ≠ 0.6 (noisy-OR property)", () => {
    const signals = [
      makeSignal("S1", 0.3, true),
      makeSignal("S2", 0.3, true),
      makeSignal("S3", 0, false),
      makeSignal("S4", 0, false),
      makeSignal("S5", 0, false),
    ];
    const result = scoreSignals(signals);
    expect(result.score).toBeCloseTo(0.51, 4);
    expect(result.score).not.toBeCloseTo(0.6, 4);
  });
});

describe("THRESHOLDS", () => {
  it("MERGE threshold is 0.7", () => {
    expect(THRESHOLDS.MERGE).toBe(0.7);
  });

  it("REVIEW threshold is 0.4", () => {
    expect(THRESHOLDS.REVIEW).toBe(0.4);
  });

  it("MERGE > REVIEW", () => {
    expect(THRESHOLDS.MERGE).toBeGreaterThan(THRESHOLDS.REVIEW);
  });
});
