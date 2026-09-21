/**
 * Portuguese text processing for the rule-based analyzer.
 *
 * Deliberately small and explicit: normalize, drop stopwords, keep terms and
 * bigrams. No stemming library — Portuguese stemming is a research problem,
 * and a wrong stem silently merges themes that should stay apart.
 */

/** Words that carry no topic signal in Brazilian Portuguese business writing. */
const STOPWORDS = new Set([
  "a", "o", "e", "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas", "um", "uma",
  "uns", "umas", "para", "por", "com", "sem", "que", "se", "ao", "aos", "as", "os", "ou", "mas",
  "como", "mais", "menos", "muito", "muita", "muitos", "muitas", "ja", "nao", "sim", "esta",
  "este", "esse", "essa", "isso", "aquele", "aquela", "aquilo", "ser", "estar", "ter", "tem",
  "foi", "sao", "era", "eram", "sera", "seria", "fazer", "faz", "feito", "pode", "podem",
  "deve", "devem", "vai", "vao", "esta", "estao", "nosso", "nossa", "nossos", "nossas", "seu",
  "sua", "seus", "suas", "eles", "elas", "eu", "ele", "ela", "nos", "voce", "voces", "lhe",
  "pelo", "pela", "pelos", "pelas", "entre", "sobre", "ate", "desde", "apos", "antes", "durante",
  "quando", "onde", "porque", "pois", "entao", "assim", "tambem", "ainda", "so", "apenas",
  "todo", "toda", "todos", "todas", "outro", "outra", "outros", "outras", "mesmo", "mesma",
  "cada", "qualquer", "algum", "alguma", "alguns", "algumas", "nenhum", "nenhuma", "ne",
  "ficou", "ficar", "fica", "dar", "da", "dizer", "disse", "ver", "visto", "ir", "vir", "veio",
  "bem", "mal", "bom", "boa", "grande", "pequeno", "novo", "nova", "hoje", "ontem", "amanha",
  "agora", "aqui", "la", "ai", "cliente", "clientes", "produto", "produtos",
  // Generic organizational nouns. They appear in every kind of comment and
  // carry no topic: left in, a single shared "time" is enough to merge a
  // request for spreadsheet export with a complaint about legacy maintenance.
  "time", "times", "equipe", "equipes", "pessoal", "empresa", "area", "areas",
  "projeto", "projetos", "reuniao", "contato", "conta", "caso", "coisa", "parte",
  "vez", "vezes", "forma", "ponto", "pontos", "questao", "situacao", "geral",
  // Intensifiers and quantifiers. They modify whatever is next to them and
  // belong to no topic: "demora demais" and "custo alto demais" share only the
  // adverb, and leaving it in was enough to merge the two themes.
  "demais", "bastante", "pouco", "pouca", "poucos", "poucas", "tanto", "tanta",
  "tantos", "tantas", "quase", "sempre", "nunca", "talvez", "realmente",
  "certamente", "praticamente", "totalmente", "completamente", "extremamente",
  "super", "bem", "melhor", "pior", "maior", "menor", "acima", "abaixo",
]);

/** Lowercase, strip accents, keep letters, digits and spaces. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Conservative singularisation: drops a trailing "s" from words of six
 * characters or more.
 *
 * Not a stemmer — stemming Portuguese properly is a research problem and a
 * wrong stem merges themes that should stay apart. This handles only the
 * regular plural, which is what actually breaks the grouping in practice:
 * "relatórios" and "relatório" are the same subject and were landing in
 * different clusters. The six-character floor keeps short words that merely
 * end in "s" ("país", "mais", "após") untouched.
 */
export function singularize(word: string): string {
  if (word.length >= 6 && word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

/** Content words: normalized and singularised, without stopwords. */
export function tokenize(text: string): string[] {
  return normalize(text)
    .split(" ")
    // The stopword test runs on the original word AND on the singular: taking
    // the "s" off "demais" produces "demai", which is in no list and would slip
    // through as if it were a topic word.
    .filter((word) => word.length >= 4 && !/^\d+$/.test(word) && !STOPWORDS.has(word))
    .map(singularize)
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));
}

/**
 * Terms of a comment: single words plus adjacent pairs.
 *
 * The pairs are what separate "tempo de resposta" from a loose "tempo", and
 * they are why the grouping does not collapse unrelated complaints.
 */
export function extractTerms(text: string): string[] {
  const tokens = tokenize(text);
  const bigrams = tokens.slice(0, -1).map((token, index) => `${token} ${tokens[index + 1]}`);
  return [...tokens, ...bigrams];
}

/** How often each term appears across the corpus. */
export function documentFrequencies(documents: string[][]): Map<string, number> {
  const frequencies = new Map<string, number>();
  for (const terms of documents) {
    for (const term of new Set(terms)) {
      frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    }
  }
  return frequencies;
}

/**
 * Inverse document frequency: a term in every comment says nothing, a term in
 * a handful says a lot.
 */
export function idf(term: string, frequencies: Map<string, number>, total: number): number {
  const count = frequencies.get(term) ?? 0;
  if (count === 0) return 0;
  return Math.log((total + 1) / (count + 1)) + 1;
}

/** Overlap between two term sets, from 0 to 1. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const term of a) if (b.has(term)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Shared terms over the smaller set.
 *
 * This, and not Jaccard, is what the clustering uses. Jaccard divides by the
 * union, so a long comment and a short one about the same subject score low
 * simply because one of them has more words — and bigrams make it worse, since
 * they enlarge both sets while almost never matching each other ("integração
 * lenta" and "lentidão integração" are the same complaint and different
 * bigrams). The overlap coefficient asks the question that matters here: of the
 * shorter comment's vocabulary, how much does the other one share?
 */
export function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const term of a) if (b.has(term)) intersection += 1;
  return intersection / Math.min(a.size, b.size);
}

/** Splits a term list into single words and adjacent pairs. */
export function splitTerms(terms: string[]): { unigrams: Set<string>; bigrams: Set<string> } {
  const unigrams = new Set<string>();
  const bigrams = new Set<string>();
  for (const term of terms) {
    if (term.includes(" ")) bigrams.add(term);
    else unigrams.add(term);
  }
  return { unigrams, bigrams };
}

/**
 * Topic similarity: overlap of single words, with a bonus when a whole pair
 * matches — a shared bigram is strong evidence of the same subject, so it
 * counts for something without being allowed to decide on its own.
 */
export function topicSimilarity(a: string[], b: string[]): number {
  const left = splitTerms(a);
  const right = splitTerms(b);
  const base = overlapCoefficient(left.unigrams, right.unigrams);
  const sharedBigram = [...left.bigrams].some((bigram) => right.bigrams.has(bigram));
  return Math.min(1, base + (sharedBigram ? 0.15 : 0));
}

/** Words that mark a complaint, and words that mark an opening. */
const RISK_WORDS = new Set([
  "lento", "lentidao", "demora", "demorado", "instavel", "instabilidade", "queda", "falha",
  "falhas", "erro", "erros", "bug", "bugs", "problema", "problemas", "reclamacao", "reclamacoes",
  "insatisfeito", "insatisfacao", "churn", "cancelou", "cancelamento", "cancelamentos", "risco",
  "perdemos", "perdendo", "caro", "custoso", "concorrente", "concorrencia", "atraso", "atrasos",
  "indisponivel", "indisponibilidade", "dificil", "dificuldade", "confuso", "limitacao",
  "limitado", "travando", "travou", "suporte",
]);

const OPPORTUNITY_WORDS = new Set([
  "oportunidade", "interesse", "interessado", "pediu", "pedido", "pedidos", "solicitou",
  "solicitacao", "gostaria", "gostaram", "elogiou", "elogio", "elogios", "expansao", "expandir",
  "upsell", "crescer", "crescimento", "potencial", "parceria", "novo", "nova", "integracao",
  "integrar", "adotar", "adocao", "migrar", "ampliar", "contratar", "renovar", "renovacao",
]);

export function polarityOf(terms: string[], categoryCode: string | null): "risk" | "opportunity" {
  // The user's own category wins: they classified it on purpose.
  if (categoryCode === "risk" || categoryCode === "competition") return "risk";
  if (categoryCode === "opportunity") return "opportunity";

  let risk = 0;
  let opportunity = 0;
  for (const term of terms) {
    for (const word of term.split(" ")) {
      if (RISK_WORDS.has(word)) risk += 1;
      if (OPPORTUNITY_WORDS.has(word)) opportunity += 1;
    }
  }
  // Ties read as risk: an unclear signal is worth looking at, not celebrating.
  return opportunity > risk ? "opportunity" : "risk";
}

/**
 * Maps each processed token back to a spelling a reader recognises.
 *
 * Everything downstream works on accent-stripped, singularised tokens —
 * necessary for matching, unreadable on screen: a Portuguese interface showing
 * "Integracao" and "Manutencao" looks broken. The shortest original spelling
 * wins, which quietly prefers the singular over the plural.
 */
export function surfaceForms(text: string): Map<string, string> {
  const forms = new Map<string, string>();
  for (const match of text.toLocaleLowerCase("pt-BR").matchAll(/[\p{L}\p{N}]+/gu)) {
    const raw = match[0];
    const token = singularize(normalize(raw));
    if (token.length < 4 || STOPWORDS.has(token)) continue;
    const seen = forms.get(token);
    if (seen === undefined || raw.length < seen.length) forms.set(token, raw);
  }
  return forms;
}

/** Rewrites a term (word or bigram) with the spellings the comments used. */
export function prettify(term: string, forms: Map<string, string>): string {
  return term
    .split(" ")
    .map((word) => forms.get(word) ?? word)
    .join(" ");
}
