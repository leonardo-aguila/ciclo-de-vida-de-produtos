/**
 * The contract of the suggestion engine.
 *
 * Everything the application knows about turning comments into suggestions is
 * this interface. Today it is implemented by rules; replacing it with a call to
 * an LLM means writing another `CommentAnalyzer` and changing one line in
 * `index.ts` — no page, no query and no component changes.
 */

export type AnalyzedComment = {
  id: string;
  productId: string;
  productName: string;
  body: string;
  /** "YYYY-MM-DD" */
  commentDate: string;
  /** Code of the user-administered category, when there is one. */
  categoryCode: string | null;
  categoryLabel: string | null;
  authorName: string | null;
};

export type ProductSignal = {
  productId: string;
  productName: string;
  /** Current health score, for correlating a theme with how the product is doing. */
  health: number;
  /** Points gained or lost against the previous month, when known. */
  healthDelta: number | null;
};

export type SuggestionKind = "risk" | "opportunity";

export type SuggestionTrend = "rising" | "steady" | "cooling";

export type Suggestion = {
  id: string;
  /** Short, actionable headline. */
  title: string;
  /** What to do about it, in one or two sentences. */
  recommendation: string;
  kind: SuggestionKind;
  /** How many comments feed this theme. */
  frequency: number;
  /** Terms that identified the theme, for the reader to judge the grouping. */
  terms: string[];
  products: { id: string; name: string; mentions: number }[];
  trend: SuggestionTrend;
  /** Mentions in the recent window versus the earlier one. */
  trendDetail: string;
  /** Average health of the products mentioned, and how it moved. */
  affectedHealth: { average: number | null; averageDelta: number | null };
  /** Every comment behind the suggestion — the traceability the screen shows. */
  sourceCommentIds: string[];
  /** 0..1, how strongly the engine believes the grouping. */
  confidence: number;
};

export type AnalyzeInput = {
  comments: AnalyzedComment[];
  products: ProductSignal[];
  /** Reference date for the "recent versus earlier" split. */
  today: string;
  /** Months considered recent. */
  recentWindowMonths?: number;
  /** Minimum comments for a theme to be reported. */
  minFrequency?: number;
};

export interface CommentAnalyzer {
  readonly name: string;
  analyze(input: AnalyzeInput): Promise<Suggestion[]>;
}
