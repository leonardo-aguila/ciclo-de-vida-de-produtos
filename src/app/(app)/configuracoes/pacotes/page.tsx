import { listPackages } from "@/lib/queries/packages";
import { PackageList } from "./package-list";

export const dynamic = "force-dynamic";

export default async function PackagesPage() {
  const packages = await listPackages(false);

  return (
    <PackageList
      packages={packages.map((pkg) => ({
        id: pkg.id,
        name: pkg.name,
        description: pkg.description,
        targetPhase: pkg.targetPhase,
        active: pkg.active,
        taskCount: pkg.taskCount,
      }))}
    />
  );
}
