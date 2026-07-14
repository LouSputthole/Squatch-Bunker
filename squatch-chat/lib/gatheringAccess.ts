import { resolveChannelAccess } from "@/lib/channelAccess";
import { gatheringResponse } from "@/lib/gatherings";

type GatheringForResponse = Parameters<typeof gatheringResponse>[0];

export async function validateGatheringLinkedChannel(
  channelId: string,
  serverId: string,
  viewerId: string,
) {
  const access = await resolveChannelAccess(channelId, viewerId);
  if (!access || access.serverId !== serverId) {
    return {
      ok: false as const,
      status: 400,
      error: "Linked channel must belong to this server",
    };
  }
  if (!access.canView) {
    return {
      ok: false as const,
      status: 403,
      error: "Not authorized to link this channel",
    };
  }
  return { ok: true as const };
}

export async function gatheringResponseForViewer(
  gathering: GatheringForResponse,
  viewerId: string,
  canManageServer: boolean,
  now = new Date(),
) {
  let canViewChannel = gathering.channelId === null;
  if (gathering.channelId) {
    const access = await resolveChannelAccess(gathering.channelId, viewerId);
    canViewChannel =
      access?.canView === true && access.serverId === gathering.serverId;
  }

  return gatheringResponse(gathering, viewerId, {
    canManageServer,
    canViewChannel,
    now,
  });
}
