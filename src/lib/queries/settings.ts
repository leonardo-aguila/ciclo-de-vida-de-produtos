import { eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@db";
import { appSettings, type AppSettings } from "@db/schema";
import {
  DEFAULT_BP_DEVIATION_LIMIT,
  DEFAULT_CURRENCY,
  DEFAULT_HEALTH_WEIGHTS,
  DEFAULT_PROJECTION,
  DEFAULT_RECOMMENDATION_RULES,
  DEFAULT_SEMAPHORE,
} from "@/lib/defaults";

/**
 * The settings row, falling back to the defaults when it is missing — a fresh
 * database should render the app, not a crash.
 */
export const getSettings = cache(async (): Promise<AppSettings> => {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
  if (row) return row;

  return {
    id: 1,
    healthWeights: DEFAULT_HEALTH_WEIGHTS,
    semaphoreThresholds: DEFAULT_SEMAPHORE,
    recommendationRules: DEFAULT_RECOMMENDATION_RULES,
    projectionSettings: DEFAULT_PROJECTION,
    bpDeviationLimit: DEFAULT_BP_DEVIATION_LIMIT,
    defaultCurrency: DEFAULT_CURRENCY,
    updatedAt: new Date(),
    updatedBy: null,
  };
});
