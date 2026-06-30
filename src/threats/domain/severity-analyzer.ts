import { CATEGORY_WEIGHT } from './threat-category.enum';
import { Severity } from './severity.enum';
import { ThreatDetectedEvent } from './threat-detected.event';

export interface TriageVerdict {
  /** Normalized score in the inclusive range 0-100. */
  score: number;
  severity: Severity;
  /** Per-factor contributions, surfaced for auditability. */
  breakdown: {
    cvss: number;
    category: number;
    confidence: number;
    indicatorBoost: number;
  };
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Weights of the weighted-sum model; the three base factors sum to 1. */
const WEIGHTS = {
  cvss: 0.5,
  category: 0.3,
  confidence: 0.2,
} as const;

/** Each indicator of compromise adds a small boost, capped overall. */
const INDICATOR_STEP = 0.05;
const INDICATOR_MAX_BOOST = 0.2;

/** Score thresholds (inclusive lower bounds) for each severity bucket. */
export const SEVERITY_THRESHOLDS: ReadonlyArray<[number, Severity]> = [
  [85, Severity.CRITICAL],
  [60, Severity.HIGH],
  [35, Severity.MEDIUM],
  [0, Severity.LOW],
];

export const scoreToSeverity = (score: number): Severity => {
  const bounded = clamp(score, 0, 100);
  for (const [threshold, severity] of SEVERITY_THRESHOLDS) {
    if (bounded >= threshold) {
      return severity;
    }
  }
  return Severity.LOW;
};

/**
 * Deterministically scores a detected threat using a transparent weighted-sum
 * model so verdicts are reproducible and auditable (a hard requirement for a
 * security pipeline). Missing optional fields degrade gracefully to 0.
 */
export class SeverityAnalyzer {
  analyze(event: ThreatDetectedEvent): TriageVerdict {
    const normalizedCvss = clamp((event.cvssScore ?? 0) / 10, 0, 1);
    const categoryWeight = CATEGORY_WEIGHT[event.category] ?? 0.5;
    const confidence = clamp(event.confidence ?? 0, 0, 1);
    const indicatorBoost = Math.min(
      (event.indicators?.length ?? 0) * INDICATOR_STEP,
      INDICATOR_MAX_BOOST,
    );

    const cvssContribution = WEIGHTS.cvss * normalizedCvss;
    const categoryContribution = WEIGHTS.category * categoryWeight;
    const confidenceContribution = WEIGHTS.confidence * confidence;

    const combined = clamp(
      cvssContribution +
        categoryContribution +
        confidenceContribution +
        indicatorBoost,
      0,
      1,
    );

    const score = Math.round(combined * 100);

    return {
      score,
      severity: scoreToSeverity(score),
      breakdown: {
        cvss: Math.round(cvssContribution * 100),
        category: Math.round(categoryContribution * 100),
        confidence: Math.round(confidenceContribution * 100),
        indicatorBoost: Math.round(indicatorBoost * 100),
      },
    };
  }
}
