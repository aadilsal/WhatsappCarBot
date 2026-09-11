import { AuthGuard } from "@/lib/auth";
import { VehicleOverview } from "@/components/vehicle-overview";

export default async function VehiclePage({ params }: { params: Promise<{ vehicleId: string }> }) {
  const { vehicleId } = await params;
  return (
    <AuthGuard>
      <VehicleOverview vehicleId={vehicleId} />
    </AuthGuard>
  );
}
