import { redirect } from "next/navigation";

export default async function ProductIndex({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/produtos/${id}/visao-geral`);
}
