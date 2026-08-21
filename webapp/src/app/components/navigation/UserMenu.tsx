"use client";

import { signOut, useSession } from "next-auth/react";
import Image from "next/image";
import { cn } from "@/app/lib/utils";

export default function UserMenu({ theme }: { theme: string }) {
  const { data: session, status } = useSession();

  if (status === "loading" || !session?.user) return null;

  const name = session.user.name || session.user.email || "Signed in";

  return (
    <div className="flex items-center gap-2">
      {session.user.image ? (
        <Image
          src={session.user.image}
          alt=""
          width={28}
          height={28}
          className="h-7 w-7 rounded-full"
        />
      ) : (
        <div
          className={cn(
            "h-7 w-7 rounded-full flex items-center justify-center text-xs font-medium",
            theme === "dark" ? "bg-[#1E1A3C] text-[#00E0FF]" : "bg-gray-200 text-gray-700",
          )}
        >
          {name.slice(0, 1).toUpperCase()}
        </div>
      )}
      <span
        className={cn(
          "hidden lg:inline max-w-[10rem] truncate text-xs",
          theme === "dark" ? "text-gray-300" : "text-gray-600",
        )}
        title={session.user.email || name}
      >
        {name}
      </span>
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: "/login" })}
        className={cn(
          "rounded-lg px-2 py-1 text-xs font-medium transition-colors",
          theme === "dark"
            ? "text-gray-300 hover:bg-[#1A1832] hover:text-[#00E0FF]"
            : "text-gray-600 hover:bg-[#F2F2F2] hover:text-[#333]",
        )}
      >
        Sign out
      </button>
    </div>
  );
}
