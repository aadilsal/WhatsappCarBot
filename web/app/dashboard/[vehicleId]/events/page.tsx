import { AuthGuard } from "@/lib/auth";
import { EventsList } from "@/components/events-list";

export default async function EventsPage({ params }: { params: Promise<{ vehicleId: string }> }) {
  const { vehicleId } = await params;
  return (
    <AuthGuard>
      <EventsList vehicleId={vehicleId} />
    </AuthGuard>
  );
}
