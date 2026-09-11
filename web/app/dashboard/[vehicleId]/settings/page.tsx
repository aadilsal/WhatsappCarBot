import { AuthGuard } from "@/lib/auth";
import { VehicleSettings } from "@/components/vehicle-settings";

export default async function SettingsPage({ params }: { params: Promise<{ vehicleId: string }> }) {
  const { vehicleId } = await params;
  return (
    <AuthGuard>
      <VehicleSettings vehicleId={vehicleId} />
    </AuthGuard>
  );
}
