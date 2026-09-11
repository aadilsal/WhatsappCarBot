import { AuthGuard } from "@/lib/auth";
import { EventForm } from "@/components/event-form";

export default async function NewEventPage({ params }: { params: Promise<{ vehicleId: string }> }) {
  const { vehicleId } = await params;
  return (
    <AuthGuard>
      <EventForm mode="new" vehicleId={vehicleId} />
    </AuthGuard>
  );
}
