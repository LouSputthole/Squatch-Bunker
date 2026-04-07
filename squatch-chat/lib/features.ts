// Campfire Feature Flag System
// Self-hosted: all features unlocked
// Managed service: free vs premium tiers

export type Tier = "free" | "premium" | "self-hosted";

interface FeatureDefinition {
  name: string;
  description: string;
  tier: "free" | "premium"; // minimum tier required
}

export const FEATURES: Record<string, FeatureDefinition> = {
  // Free features (available to everyone)
  core_chat:         { name: "Text Chat",           description: "Channels, messages, reactions, replies, threads", tier: "free" },
  voice_chat:        { name: "Voice Chat",          description: "P2P voice with screen share and camera",         tier: "free" },
  direct_messages:   { name: "Direct Messages",     description: "Private conversations between users",            tier: "free" },
  friend_system:     { name: "Friends",             description: "Add friends, see online status",                 tier: "free" },
  file_uploads:      { name: "File Uploads",        description: "Share images and files (10MB limit)",            tier: "free" },
  ambient_sounds:    { name: "Ambient Sounds",      description: "Background sound themes",                        tier: "free" },
  custom_themes:     { name: "Theme Selection",     description: "Choose from preset themes",                      tier: "free" },
  keyboard_shortcuts:{ name: "Keyboard Shortcuts",  description: "Customizable keybinds",                          tier: "free" },
  guest_accounts:    { name: "Guest Access",        description: "Join without registration",                      tier: "free" },

  // Premium features (managed service $5/mo)
  custom_emoji:      { name: "Custom Emoji",        description: "Upload custom emoji for your server",            tier: "premium" },
  server_banner:     { name: "Server Banner",       description: "Custom banner image for your server",            tier: "premium" },
  vanity_url:        { name: "Vanity Invite URL",   description: "Custom invite links like /join/my-server",       tier: "premium" },
  admin_dashboard:   { name: "Admin Dashboard",     description: "Analytics and insights for server owners",       tier: "premium" },
  server_insights:   { name: "Server Insights",     description: "Weekly activity digests and trends",             tier: "premium" },
  backup_restore:    { name: "Backup & Restore",    description: "Export and import server data",                  tier: "premium" },
  auto_moderation:   { name: "Auto-Moderation",     description: "Word filters and automated actions",             tier: "premium" },
  scheduled_messages:{ name: "Scheduled Messages",  description: "Send messages at a future time",                 tier: "premium" },
  two_factor_auth:   { name: "Two-Factor Auth",     description: "TOTP-based 2FA for account security",           tier: "premium" },
  sso_oauth:         { name: "SSO / OAuth",         description: "Sign in with Google, GitHub, etc.",              tier: "premium" },
  priority_support:  { name: "Priority Support",    description: "Fast-track support from the team",               tier: "premium" },
  extended_upload:   { name: "Extended Uploads",     description: "Upload files up to 100MB",                      tier: "premium" },
  server_discovery:  { name: "Server Discovery",    description: "List your server in the public directory",       tier: "premium" },
};

const SELF_HOSTED = process.env.SELF_HOSTED === "true" || !process.env.STRIPE_SECRET_KEY;

/** Check if a tier has access to a feature */
export function hasFeature(tier: Tier, feature: string): boolean {
  // Self-hosted gets everything
  if (tier === "self-hosted" || SELF_HOSTED) return true;

  const def = FEATURES[feature];
  if (!def) return false;

  if (def.tier === "free") return true;
  if (def.tier === "premium" && tier === "premium") return true;

  return false;
}

/** Get all features available for a tier */
export function getFeatures(tier: Tier): string[] {
  return Object.keys(FEATURES).filter((key) => hasFeature(tier, key));
}

/** Determine the effective tier for a user */
export function getTier(user?: { tier?: string; tierExpiresAt?: Date | string | null } | null): Tier {
  if (SELF_HOSTED) return "self-hosted";
  if (!user) return "free";

  if (user.tier === "premium") {
    // Check expiry
    if (user.tierExpiresAt) {
      const expires = new Date(user.tierExpiresAt);
      if (expires < new Date()) return "free"; // expired
    }
    return "premium";
  }

  return "free";
}

/** Get the display name and price for each tier */
export const TIER_INFO = {
  free: { name: "Free", price: "$0/mo", description: "Full Campfire experience" },
  premium: { name: "Premium", price: "$5/mo", description: "Extra features + priority support" },
  "self-hosted": { name: "Self-Hosted", price: "Free forever", description: "All features, your server" },
} as const;
