"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { logout, me } from "@/lib/api";

export function AppHeader() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: user } = useQuery({ queryKey: ["me"], queryFn: me });

  async function handleLogout() {
    await logout();
    queryClient.clear();
    router.push("/login");
  }

  return (
    <header className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
      <a href="/projects" className="font-semibold">
        AgentTrace
      </a>
      <div className="flex items-center gap-4 text-sm text-gray-600">
        {user && <span>{user.email}</span>}
        <button onClick={() => void handleLogout()} className="underline">
          Log out
        </button>
      </div>
    </header>
  );
}
