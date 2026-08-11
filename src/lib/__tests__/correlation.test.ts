import { describe, it, expect } from "vitest";
import { computeTemporalDecay, deltaHoursBetween } from "@/lib/correlation/signals";

describe("temporal decay", () => {
  it("returns 1.0 for delta=0 hours", () => {
    expect(computeTemporalDecay(0)).toBeCloseTo(1.0, 4);
  });

  it("decays over time", () => {
    const at0 = computeTemporalDecay(0);
    const at24 = computeTemporalDecay(24);
    expect(at24).toBeLessThan(at0);
  });

  it("decays to e^(-λ) after 24 hours", () => {
    // λ = 0.01 days⁻¹, so after 1 day (24h): e^(-0.01)
    const decay = computeTemporalDecay(24);
    expect(decay).toBeCloseTo(Math.exp(-0.01), 4);
  });

  it("is symmetric in deltaHours", () => {
    expect(computeTemporalDecay(-5)).toBe(computeTemporalDecay(5));
  });
});

describe("deltaHoursBetween", () => {
  it("computes positive delta", () => {
    const d1 = new Date("2025-01-01T00:00:00Z");
    const d2 = new Date("2025-01-01T12:00:00Z");
    expect(deltaHoursBetween(d1, d2)).toBeCloseTo(12, 2);
  });

  it("is symmetric", () => {
    const d1 = new Date("2025-01-01T00:00:00Z");
    const d2 = new Date("2025-01-02T00:00:00Z");
    expect(deltaHoursBetween(d1, d2)).toBeCloseTo(24, 2);
    expect(deltaHoursBetween(d2, d1)).toBeCloseTo(24, 2);
  });
});
