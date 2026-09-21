import { requireUser } from "@/lib/auth/guard";
import { analyzer } from "@/lib/insights-engine";
import { listCommentsFor } from "@/lib/queries/comments";
import { getPortfolioOverview } from "@/lib/queries/dashboard";
import { listEnumValues } from "@/lib/queries/enums";
import { listProductOwners } from "@/lib/queries/products";
import { getSettings } from "@/lib/queries/settings";
import type { LifecyclePhase } from "@db/schema";
import { PHASE_ORDER } from "@/lib/labels";
import { DashboardClient } from "./dashboard-client";

export const metadata = { title: "Painel executivo — portfolio" };
export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    fase?: string;
    responsavel?: string;
    categoria?: string;
    de?: string;
    ate?: string;
  }>;
}) {
  await requireUser();
  const params = await searchParams;

  const phase = PHASE_ORDER.includes(params.fase as LifecyclePhase)
    ? (params.fase as LifecyclePhase)
    : undefined;

  const overview = await getPortfolioOverview({
    phase,
    ownerId: params.responsavel || undefined,
    categoryId: params.categoria || undefined,
    from: params.de ? `${params.de.slice(0, 7)}-01` : undefined,
    to: params.ate ? `${params.ate.slice(0, 7)}-01` : undefined,
  });

  const [owners, categories, settings] = await Promise.all([
    listProductOwners(),
    listEnumValues("product_category"),
    getSettings(),
  ]);

  // Only the comments of the products in scope: filtering the dashboard and
  // leaving the suggestions reading the whole portfolio would contradict it.
  const comments = await listCommentsFor(overview.products.map((product) => product.id));

  const suggestions = await analyzer.analyze({
    comments: comments.map((comment) => ({
      id: comment.id,
      productId: comment.productId,
      productName: comment.productName,
      body: comment.body,
      commentDate: comment.commentDate,
      categoryCode: comment.categoryCode,
      categoryLabel: comment.categoryLabel,
      authorName: comment.authorName,
    })),
    products: overview.products.map((product) => ({
      productId: product.id,
      productName: product.name,
      health: product.health,
      healthDelta: product.healthDelta,
    })),
    today: overview.today,
  });

  return (
    <DashboardClient
      overview={overview}
      suggestions={suggestions}
      comments={comments.map((comment) => ({
        id: comment.id,
        productId: comment.productId,
        productName: comment.productName,
        body: comment.body,
        commentDate: comment.commentDate,
        categoryLabel: comment.categoryLabel,
        authorName: comment.authorName,
      }))}
      engineName={analyzer.name}
      owners={owners.map((owner) => ({ id: owner.id, label: owner.name }))}
      categories={categories.map((category) => ({ id: category.id, label: category.label }))}
      healthThreshold={settings.semaphoreThresholds.green}
      currency={settings.defaultCurrency}
    />
  );
}
