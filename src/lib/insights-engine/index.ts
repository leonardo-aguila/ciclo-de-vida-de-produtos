/**
 * The suggestion engine, behind one swap point.
 *
 * To move to an LLM: write a class implementing `CommentAnalyzer`, import it
 * here, and change the constant below. Nothing else in the application knows
 * which implementation is running.
 */
import { RuleBasedAnalyzer } from "./rule-based";
import type { AnalyzeInput, CommentAnalyzer, Suggestion } from "./types";

export const analyzer: CommentAnalyzer = new RuleBasedAnalyzer();

export async function analyzeComments(input: AnalyzeInput): Promise<Suggestion[]> {
  return analyzer.analyze(input);
}

export { RuleBasedAnalyzer };
export type {
  AnalyzeInput,
  AnalyzedComment,
  CommentAnalyzer,
  ProductSignal,
  Suggestion,
  SuggestionKind,
  SuggestionTrend,
} from "./types";
