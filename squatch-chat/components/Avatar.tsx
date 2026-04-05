"use client";

import { initials } from "@/lib/utils";

interface AvatarProps {
  username: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}

export default function Avatar({ username, avatarUrl, size = 40, className = "" }: AvatarProps) {
  const sizeClass = size <= 24 ? "text-[10px]" : size <= 32 ? "text-xs" : size <= 48 ? "text-sm" : "text-xl";

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={username}
        width={size}
        height={size}
        className={`rounded-full object-cover shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className={`rounded-full flex items-center justify-center font-bold shrink-0 ${sizeClass} ${className}`}
      style={{ width: size, height: size }}
    >
      {initials(username)}
    </div>
  );
}
