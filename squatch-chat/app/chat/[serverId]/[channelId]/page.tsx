import { redirect } from "next/navigation";

export default async function ChannelPage({
  params,
}: {
  params: Promise<{ serverId: string; channelId: string }>;
}) {
  // All chat routing is handled by the main /chat page with client-side state
  const { serverId, channelId } = await params;
  redirect(`/chat?s=${encodeURIComponent(serverId)}&c=${encodeURIComponent(channelId)}`);
}
