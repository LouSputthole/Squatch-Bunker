"use client";

interface AvatarProps {
  username: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}

export default function Avatar({ username, avatarUrl, size = 40, className = "" }: AvatarProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- avatar URLs may be user-hosted, data, or blob URLs
    <img
      src={avatarUrl || "/Default-Avatar.png"}
      alt={username}
      width={size}
      height={size}
      className={`rounded-full object-cover shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
