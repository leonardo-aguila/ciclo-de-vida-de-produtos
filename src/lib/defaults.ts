/**
 * Default configuration. The user edits all of this on the settings page; these
 * are the values a fresh database starts with, and the fallback the engine uses
 * when a settings row has not been loaded (tests, for instance).
 */
import type {
  HealthWeights,
  ProjectionSettings,
  RecommendationRules,
  SemaphoreThresholds,
} from "@db/schema";

/** Weights add up to 100. The settings page enforces that. */
export const DEFAULT_HEALTH_WEIGHTS: HealthWeights = {
  goal: 30,
  financial: 25,
  execution: 20,
  businessPlan: 15,
  risk: 10,
};

export const DEFAULT_SEMAPHORE: SemaphoreThresholds = { green: 75, amber: 50 };

export const DEFAULT_RECOMMENDATION_RULES: RecommendationRules = {
  scale: { minHealth: 75, minRoi: 0, minMomGrowth: 0 },
  keep: { minHealth: 50, maxHealth: 74, minProjectedRoi: 0 },
  watch: { minHealth: 50, maxHealth: 74 },
  pivot: { minNegativeMarginMonths: 3 },
  discontinue: { maxRoi: 0, maxProjectedRoi: 0, minDecliningMonths: 3 },
};

export const DEFAULT_PROJECTION: ProjectionSettings = {
  /** Months of history the linear regression looks at. */
  windowMonths: 6,
  horizonMonths: 12,
};

/** Accumulated business-plan deviation (%) that flags the need for an action plan. */
export const DEFAULT_BP_DEVIATION_LIMIT = -15;

export const DEFAULT_CURRENCY = "BRL";

/** Session lifetime and the lockout policy, shared by the auth code and its tests. */
export const SESSION_TTL_DAYS = 7;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;
export const MIN_PASSWORD_LENGTH = 10;
export const BCRYPT_ROUNDS = 12;
