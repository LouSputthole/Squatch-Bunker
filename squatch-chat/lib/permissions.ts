// Role hierarchy: owner > admin > mod > member
const ROLE_LEVEL: Record<string, number> = {
  owner: 4,
  admin: 3,
  mod: 2,
  member: 1,
};

export type Role = "owner" | "admin" | "mod" | "member";

export function roleLevel(role: string): number {
  return ROLE_LEVEL[role] || 0;
}

export function canManageMessages(role: string): boolean {
  return roleLevel(role) >= ROLE_LEVEL.mod;
}

export function canManageChannels(role: string): boolean {
  return roleLevel(role) >= ROLE_LEVEL.admin;
}

export function canManageMembers(role: string): boolean {
  return roleLevel(role) >= ROLE_LEVEL.admin;
}

export function canKickFromVoice(role: string): boolean {
  return roleLevel(role) >= ROLE_LEVEL.mod;
}

export function canServerMute(role: string): boolean {
  return roleLevel(role) >= ROLE_LEVEL.mod;
}

export function canAssignRole(assignerRole: string, targetRole: string): boolean {
  return roleLevel(assignerRole) > roleLevel(targetRole);
}

export function canDeleteServer(role: string): boolean {
  return role === "owner";
}

export const ROLE_COLORS: Record<string, string> = {
  owner: "#f59e0b",  // amber
  admin: "#ef4444",  // red
  mod: "#3b82f6",    // blue
  member: "",        // default
};

export const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  mod: "Moderator",
  member: "Member",
};

// ─────────────────────────────────────────────────────────────────────────
// Custom roles + granular permissions
// ─────────────────────────────────────────────────────────────────────────

export const PERMISSIONS = {
  MANAGE_SERVER: "Manage Server",
  MANAGE_ROLES: "Manage Roles",
  MANAGE_CHANNELS: "Manage Channels",
  MANAGE_MESSAGES: "Manage Messages",
  KICK_MEMBERS: "Kick Members",
  BAN_MEMBERS: "Ban Members",
  TIMEOUT_MEMBERS: "Timeout Members",
  MANAGE_EMOJIS: "Manage Emojis",
  VIEW_AUDIT_LOG: "View Audit Log",
  MENTION_EVERYONE: "Mention @everyone",
  MUTE_MEMBERS: "Voice: Mute / Deafen Members",
  MOVE_MEMBERS: "Voice: Move / Disconnect Members",
  MANAGE_SOUNDSCAPE: "Manage Server Soundscape",
} as const;

export type PermKey = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermKey[];

export const PERMISSION_DESCRIPTIONS: Record<PermKey, string> = {
  MANAGE_SERVER: "Edit server name, icon, and settings",
  MANAGE_ROLES: "Create, edit, delete roles and assign them to members",
  MANAGE_CHANNELS: "Create, rename, delete, and configure channels",
  MANAGE_MESSAGES: "Delete and pin others' messages, purge channels",
  KICK_MEMBERS: "Remove members from the server",
  BAN_MEMBERS: "Ban members and manage the ban list",
  TIMEOUT_MEMBERS: "Temporarily mute members in text channels",
  MANAGE_EMOJIS: "Add and remove custom emoji",
  VIEW_AUDIT_LOG: "View the server audit log",
  MENTION_EVERYONE: "Use @everyone and @here",
  MUTE_MEMBERS: "Server-mute or deafen members in voice",
  MOVE_MEMBERS: "Move or disconnect members in voice",
  MANAGE_SOUNDSCAPE: "Set the shared ambient soundscape for the server",
};

// Legacy tier -> permission set. Seeds the 4 default roles and acts as the
// baseline for members who predate custom-role assignment.
export const TIER_PERMISSIONS: Record<Role, PermKey[]> = {
  owner: [...ALL_PERMISSIONS],
  admin: [...ALL_PERMISSIONS],
  mod: ["MANAGE_MESSAGES", "KICK_MEMBERS", "TIMEOUT_MEMBERS", "MUTE_MEMBERS", "MOVE_MEMBERS", "VIEW_AUDIT_LOG", "MENTION_EVERYONE", "MANAGE_SOUNDSCAPE"],
  member: [],
};

// Definitions used to seed a server's default roles (mapped from the old tiers).
export const DEFAULT_ROLE_SEEDS: { name: string; color: string; tier: Role; isDefault: boolean; position: number }[] = [
  { name: "Owner", color: "#f59e0b", tier: "owner", isDefault: false, position: 100 },
  { name: "Admin", color: "#ef4444", tier: "admin", isDefault: false, position: 80 },
  { name: "Moderator", color: "#3b82f6", tier: "mod", isDefault: false, position: 50 },
  { name: "Member", color: "#99aab5", tier: "member", isDefault: true, position: 0 },
];

export function parsePermissions(json: string | null | undefined): PermKey[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((k): k is PermKey => typeof k === "string" && (ALL_PERMISSIONS as string[]).includes(k)) : [];
  } catch {
    return [];
  }
}

interface PermContext {
  isOwner?: boolean;
  tier?: string; // legacy ServerMember.role
  rolePermissionJsons?: (string | null)[]; // permissions JSON from each assigned custom role
}

/** Effective permission set: owner = all; else legacy-tier baseline ∪ custom roles. */
export function effectivePermissions(ctx: PermContext): Set<PermKey> {
  if (ctx.isOwner) return new Set(ALL_PERMISSIONS);
  const set = new Set<PermKey>();
  for (const p of TIER_PERMISSIONS[(ctx.tier as Role)] || []) set.add(p);
  for (const json of ctx.rolePermissionJsons || []) {
    for (const p of parsePermissions(json)) set.add(p);
  }
  return set;
}

export function hasPermission(perm: PermKey, ctx: PermContext): boolean {
  return ctx.isOwner === true || effectivePermissions(ctx).has(perm);
}
