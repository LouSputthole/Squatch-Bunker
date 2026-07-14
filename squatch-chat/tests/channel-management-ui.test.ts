import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ChannelList from "@/components/ChannelList";
import VoiceRoom from "@/components/VoiceRoom";

const TestableChannelList = ChannelList as unknown as ComponentType<
  Record<string, unknown>
>;
const TestableVoiceRoom = VoiceRoom as unknown as ComponentType<
  Record<string, unknown>
>;

function renderChannelList(canManageChannels: boolean) {
  return renderToStaticMarkup(
    createElement(TestableChannelList, {
      serverName: "UI permissions",
      serverId: "server-1",
      channels: [
        { id: "text-1", name: "general", type: "text" },
        { id: "voice-1", name: "lodge", type: "voice" },
      ],
      currentUserId: "user-1",
      currentUserRole: "member",
      canManageChannels,
      onChannelSelect: () => undefined,
      onChannelCreated: () => undefined,
    }),
  );
}

function renderVoiceRoom(
  currentUserRole: string,
  canManageChannels: boolean,
) {
  return renderToStaticMarkup(
    createElement(TestableVoiceRoom, {
      channelId: "voice-1",
      channelName: "Lodge",
      roomScene: "campfire",
      participants: [
        { userId: "user-1", username: "camper", muted: false },
      ],
      currentUserId: "user-1",
      currentUserRole,
      canManageChannels,
      muted: false,
      deafened: false,
      onToggleMute: () => undefined,
      onToggleDeafen: () => undefined,
      onDisconnect: () => undefined,
      voiceChannels: [],
      serverId: "server-1",
      onPlaySound: () => undefined,
    }),
  );
}

function sharedSceneButton(markup: string) {
  const button = markup.match(
    /<button[^>]*title="[^"]*shared[^"]*scene"[^>]*>/,
  )?.[0];
  expect(button).toBeDefined();
  return button!;
}

describe("channel-management UI state", () => {
  it("hides channel creation controls without MANAGE_CHANNELS", () => {
    const markup = renderChannelList(false);
    expect(markup).not.toContain('aria-label="Create channel"');
    expect(markup).not.toContain('aria-label="Create voice channel"');
  });

  it("shows channel creation controls to a custom channel manager", () => {
    const markup = renderChannelList(true);
    expect(markup).toContain('aria-label="Create channel"');
    expect(markup).toContain('aria-label="Create voice channel"');
  });

  it("does not let a legacy moderator change the shared scene", () => {
    const button = sharedSceneButton(renderVoiceRoom("mod", false));
    expect(button).toContain("disabled");
    expect(button).toContain("Only channel managers");
  });

  it("lets a custom channel manager change the shared scene", () => {
    const button = sharedSceneButton(renderVoiceRoom("member", true));
    expect(button).not.toContain("disabled");
    expect(button).toContain("Change the shared room scene");
  });
});
