import { AuthGuard } from "@/lib/auth";
import { RulesList } from "@/components/rules-list";

export default async function RulesPage({ params }: { params: Promise<{ vehicleId: string }> }) {
  const { vehicleId } = await params;
  return (
    <AuthGuard>
      <RulesList vehicleId={vehicleId} />
    </AuthGuard>
  );
}
