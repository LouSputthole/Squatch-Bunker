import { redirect } from "next/navigation";

export default async function ServerPage({ params }: { params: Promise<{ serverId: string }> }) {
  // All chat routing is handled by the main /chat page with client-side state
  const { serverId } = await params;
  redirect(`/chat?s=${encodeURIComponent(serverId)}`);
}
