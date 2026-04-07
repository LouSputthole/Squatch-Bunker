"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { disconnectSocket } from "@/lib/socket";
import type { User } from "@/types/chat";

export function useAuth() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async (): Promise<User | null> => {
    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) {
        router.push("/login");
        return null;
      }
      const data = await res.json();
      setUser(data.user);
      setLoading(false);
      return data.user;
    } catch {
      router.push("/login");
      return null;
    }
  }, [router]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    disconnectSocket();
    router.push("/login");
  }, [router]);

  const updateAvatar = useCallback((avatar: string | null) => {
    setUser((prev) => prev ? { ...prev, avatar } : prev);
  }, []);

  return { user, loading, setLoading, fetchUser, logout, updateAvatar };
}
