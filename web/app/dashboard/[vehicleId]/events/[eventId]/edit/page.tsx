import { AuthGuard } from "@/lib/auth";
import { EventForm } from "@/components/event-form";

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ vehicleId: string; eventId: string }>;
}) {
  const { vehicleId, eventId } = await params;
  return (
    <AuthGuard>
      <EventForm mode="edit" vehicleId={vehicleId} eventId={eventId} />
    </AuthGuard>
  );
}
