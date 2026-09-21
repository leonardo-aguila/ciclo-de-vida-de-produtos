/**
 * Rule-based comment analyzer.
 *
 * Normalize → extract terms → weight by tf-idf → group by similarity →
 * measure the trend over time → correlate with the health of the products
 * mentioned → classify as risk or opportunity.
 *
 * It is deliberately explainable: every suggestion carries the terms that
 * formed it and the ids of the comments behind it, so a person can disagree
 * with the grouping instead of having to trust it.
 */
import { addMonthsToCompetence, toCompetence } from "@/lib/format";
import {
  documentFrequencies,
  extractTerms,
  idf,
  polarityOf,
  prettify,
  surfaceForms,
  topicSimilarity,
} from "./text";
import type {
  AnalyzeInput,
  AnalyzedComment,
  CommentAnalyzer,
  Suggestion,
  SuggestionTrend,
} from "./types";

/**
 * Comments this similar are treated as the same theme. Measured with the
 * overlap coefficient over single words (see `topicSimilarity`), where 0.25
 * means a quarter of the shorter comment's vocabulary is shared.
 */
const SIMILARITY_THRESHOLD = 0.25;
/** Terms kept per comment for the similarity comparison. */
const TERMS_PER_COMMENT = 10;
/**
 * A term present in more than this share of the corpus discriminates nothing.
 * Only applied once there is a corpus worth the name — with five comments,
 * "everything is ubiquitous".
 */
const UBIQUITOUS_SHARE = 0.6;
const MIN_CORPUS_FOR_PRUNING = 8;

type Cluster = {
  comments: AnalyzedComment[];
  termLists: string[][];
  weights: Map<string, number>;
};

/**
 * The terms a comment is compared by.
 *
 * Deliberately NOT ranked by tf-idf: idf rewards what is unique to a document,
 * and the words shared between two comments are exactly what makes them the
 * same theme. Ranking by idf would push the shared vocabulary out of the
 * comparison set and stop the grouping from ever happening. idf is used later,
 * to label the cluster — there, being distinctive is the point.
 */
function comparisonTerms(
  comment: AnalyzedComment,
  frequencies: Map<string, number>,
  total: number,
): { terms: string[]; weights: Map<string, number> } {
  const terms = extractTerms(comment.body);
  const counts = new Map<string, number>();
  for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);

  const prune = total >= MIN_CORPUS_FOR_PRUNING;

  const scored = Array.from(counts.entries())
    .filter(([term]) => {
      if (!prune) return true;
      return (frequencies.get(term) ?? 0) / total <= UBIQUITOUS_SHARE;
    })
    .map(([term, count]) => ({
      term,
      // A bigram that survives is worth more than either of its words.
      salience: count * (term.includes(" ") ? 1.6 : 1),
      // Kept for labelling the cluster afterwards.
      weight: count * idf(term, frequencies, total) * (term.includes(" ") ? 1.6 : 1),
    }))
    .sort((a, b) => b.salience - a.salience)
    .slice(0, TERMS_PER_COMMENT);

  return {
    terms: scored.map((item) => item.term),
    weights: new Map(scored.map((item) => [item.term, item.weight])),
  };
}

/** Single-pass agglomerative grouping: each comment joins its closest cluster. */
function cluster(
  comments: AnalyzedComment[],
  termsByComment: Map<string, { terms: string[]; weights: Map<string, number> }>,
): Cluster[] {
  const clusters: Cluster[] = [];

  for (const comment of comments) {
    const entry = termsByComment.get(comment.id)!;
    if (entry.terms.length === 0) continue;

    let best: { cluster: Cluster; score: number } | null = null;
    for (const candidate of clusters) {
      // Compare against the closest member, not an average: an average
      // centroid drifts and starts swallowing unrelated comments.
      const score = Math.max(
        ...candidate.termLists.map((terms) => topicSimilarity(entry.terms, terms)),
      );
      if (score >= SIMILARITY_THRESHOLD && (!best || score > best.score)) {
        best = { cluster: candidate, score };
      }
    }

    if (best) {
      best.cluster.comments.push(comment);
      best.cluster.termLists.push(entry.terms);
      for (const [term, weight] of entry.weights) {
        best.cluster.weights.set(term, (best.cluster.weights.get(term) ?? 0) + weight);
      }
    } else {
      clusters.push({
        comments: [comment],
        termLists: [entry.terms],
        weights: new Map(entry.weights),
      });
    }
  }

  return clusters;
}

function titleFrom(terms: string[]): string {
  const lead = terms[0] ?? "tema recorrente";
  const capitalized = lead.charAt(0).toUpperCase() + lead.slice(1);
  const support = terms.slice(1, 3).filter((term) => !lead.includes(term));
  return support.length > 0 ? `${capitalized} (${support.join(", ")})` : capitalized;
}

function recommendationFor(
  kind: "risk" | "opportunity",
  frequency: number,
  productCount: number,
  trend: SuggestionTrend,
): string {
  const scope =
    productCount > 1
      ? `Aparece em ${productCount} produtos`
      : "Concentrado em um produto";
  const movement =
    trend === "rising"
      ? "e vem crescendo nos últimos meses"
      : trend === "cooling"
        ? "mas vem esfriando"
        : "e se mantém estável";

  if (kind === "risk") {
    return `${scope} ${movement}. ${
      frequency >= 5
        ? "Vale abrir um plano de ação com causa-raiz identificada."
        : "Vale converter em insight e acompanhar antes que vire churn."
    }`;
  }
  return `${scope} ${movement}. ${
    frequency >= 5
      ? "Volume suficiente para virar item de roadmap."
      : "Vale converter em insight e dimensionar esforço e impacto."
  }`;
}

export class RuleBasedAnalyzer implements CommentAnalyzer {
  readonly name = "regras";

  async analyze(input: AnalyzeInput): Promise<Suggestion[]> {
    const { comments, products, today } = input;
    const recentWindowMonths = input.recentWindowMonths ?? 3;
    const minFrequency = input.minFrequency ?? 2;

    if (comments.length === 0) return [];

    const documents = comments.map((comment) => extractTerms(comment.body));
    // One dictionary for the whole corpus: the reader sees the words as they
    // were written, even when the match happened on the stripped form.
    const surfaces = new Map<string, string>();
    for (const comment of comments) {
      for (const [token, form] of surfaceForms(comment.body)) {
        const seen = surfaces.get(token);
        if (seen === undefined || form.length < seen.length) surfaces.set(token, form);
      }
    }
    const frequencies = documentFrequencies(documents);

    const termsByComment = new Map(
      comments.map((comment) => [
        comment.id,
        comparisonTerms(comment, frequencies, comments.length),
      ]),
    );

    const clusters = cluster(comments, termsByComment);
    const healthByProduct = new Map(products.map((product) => [product.productId, product]));
    const cutoff = addMonthsToCompetence(toCompetence(today), -recentWindowMonths);

    const suggestions = clusters
      .filter((group) => group.comments.length >= minFrequency)
      .map((group, index): Suggestion => {
        const terms = Array.from(group.weights.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([term]) => prettify(term, surfaces));

        const mentions = new Map<string, { name: string; count: number }>();
        for (const comment of group.comments) {
          const current = mentions.get(comment.productId);
          mentions.set(comment.productId, {
            name: comment.productName,
            count: (current?.count ?? 0) + 1,
          });
        }

        const recent = group.comments.filter((comment) => comment.commentDate >= cutoff).length;
        const earlier = group.comments.length - recent;
        const trend: SuggestionTrend =
          recent > earlier ? "rising" : recent < earlier ? "cooling" : "steady";

        const affected = Array.from(mentions.keys())
          .map((productId) => healthByProduct.get(productId))
          .filter((product): product is NonNullable<typeof product> => Boolean(product));

        const averageHealth =
          affected.length > 0
            ? affected.reduce((sum, product) => sum + product.health, 0) / affected.length
            : null;

        const deltas = affected
          .map((product) => product.healthDelta)
          .filter((delta): delta is number => delta !== null);
        const averageDelta =
          deltas.length > 0 ? deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length : null;

        // Category beats inference: the user classified it on purpose.
        const categoryVotes = group.comments
          .map((comment) => comment.categoryCode)
          .filter((code): code is string => Boolean(code));
        const dominantCategory =
          categoryVotes.length > 0
            ? categoryVotes.sort(
                (a, b) =>
                  categoryVotes.filter((code) => code === b).length -
                  categoryVotes.filter((code) => code === a).length,
              )[0]!
            : null;

        const kind = polarityOf(
          group.comments.flatMap((comment) => extractTerms(comment.body)),
          dominantCategory,
        );

        // More comments and more products make the grouping more believable.
        const confidence = Math.min(
          1,
          0.3 + group.comments.length * 0.12 + (mentions.size > 1 ? 0.15 : 0),
        );

        return {
          id: `theme-${index + 1}`,
          title: titleFrom(terms),
          recommendation: recommendationFor(kind, group.comments.length, mentions.size, trend),
          kind,
          frequency: group.comments.length,
          terms,
          products: Array.from(mentions.entries()).map(([id, value]) => ({
            id,
            name: value.name,
            mentions: value.count,
          })),
          trend,
          trendDetail: `${recent} ${recent === 1 ? "comentário" : "comentários"} nos últimos ${recentWindowMonths} meses contra ${earlier} antes disso.`,
          affectedHealth: { average: averageHealth, averageDelta: averageDelta },
          sourceCommentIds: group.comments.map((comment) => comment.id),
          confidence,
        };
      });

    // Risks first, then by how much evidence there is.
    return suggestions.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "risk" ? -1 : 1;
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return b.confidence - a.confidence;
    });
  }
}
