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
