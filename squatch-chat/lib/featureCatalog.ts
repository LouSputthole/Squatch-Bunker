export type Tier = "free" | "premium" | "self-hosted";

export interface FeatureDefinition {
  name: string;
  description: string;
  tier: "free" | "premium";
  status?: "available" | "planned";
}

export const FEATURES: Record<string, FeatureDefinition> = {
  core_chat: { name: "Text Chat", description: "Channels, messages, reactions, replies, threads", tier: "free" },
  voice_chat: { name: "Voice Chat", description: "P2P voice with screen share and camera", tier: "free" },
  direct_messages: { name: "Direct Messages", description: "Private realtime conversations", tier: "free" },
  friend_system: { name: "Friends and Blocks", description: "Friends, presence, and personal block controls", tier: "free" },
  file_uploads: { name: "File Uploads", description: "Share images, files, and voice notes up to 10MB", tier: "free" },
  ambient_sounds: { name: "Shared Scenes", description: "Voice-room purposes, scenes, and ambient sounds", tier: "free" },
  custom_themes: { name: "Theme Selection", description: "Preset and custom themes", tier: "free" },
  keyboard_shortcuts: { name: "Keyboard Shortcuts", description: "Fast keyboard navigation", tier: "free" },
  guest_accounts: { name: "Guest Access", description: "Join without registration", tier: "free" },
  managed_invites: { name: "Managed Invites", description: "Expiring, limited-use, revocable invitations", tier: "free" },
  camp_journal: { name: "Camp Journal", description: "Private message keepsakes", tier: "free" },
  camp_votes: { name: "Camp Votes", description: "Realtime single- and multi-choice polls", tier: "free" },
  camp_gatherings: { name: "Camp Gatherings", description: "Events, reminders, and RSVP tracking", tier: "free" },
  voice_facilitation: { name: "Voice Facilitation", description: "Pass the Lantern and Offshoot side rooms", tier: "free" },
  retention_rooms: { name: "Leave-no-trace Rooms", description: "Optional 1, 7, or 30 day message retention", tier: "free" },

  custom_emoji: { name: "Custom Emoji", description: "Upload custom emoji for your server", tier: "premium" },
  server_banner: { name: "Server Banner", description: "Custom banner image for your server", tier: "premium" },
  backup_restore: { name: "Channel Export", description: "Export channel history", tier: "premium" },
  scheduled_messages: { name: "Scheduled Messages", description: "Send messages at a future time", tier: "premium" },
  extended_upload: { name: "Extended Uploads", description: "Upload files up to 100MB", tier: "premium" },

  vanity_url: { name: "Vanity Invite URL", description: "Custom invite slugs", tier: "premium", status: "planned" },
  admin_dashboard: { name: "Community Insights", description: "Owner analytics and insights", tier: "premium", status: "planned" },
  server_insights: { name: "Activity Digests", description: "Weekly activity digests and trends", tier: "premium", status: "planned" },
  auto_moderation: { name: "Authoritative Auto-Moderation", description: "Server-enforced content rules", tier: "premium", status: "planned" },
  two_factor_auth: { name: "Two-Factor Auth", description: "TOTP account security", tier: "premium", status: "planned" },
  sso_oauth: { name: "SSO / OAuth", description: "Managed identity providers", tier: "premium", status: "planned" },
  priority_support: { name: "Priority Support", description: "Managed support service", tier: "premium", status: "planned" },
  server_discovery: { name: "Server Discovery", description: "Public community directory", tier: "premium", status: "planned" },
  sfu_voice: { name: "Big Voice Rooms", description: "SFU-backed voice beyond the peer mesh", tier: "premium", status: "planned" },
};

export const TIER_INFO = {
  free: { name: "Cloud Free", price: "$0/mo", description: "Core Campfire on the managed service" },
  premium: { name: "Cloud Plus", price: "Configured in Stripe", description: "Higher limits and managed extras" },
  "self-hosted": { name: "Community", price: "Free forever", description: "All shipped code features on infrastructure you control" },
} as const;

export const AVAILABLE_FREE_FEATURES = Object.keys(FEATURES).filter(
  (key) => FEATURES[key].tier === "free" && FEATURES[key].status !== "planned",
);
