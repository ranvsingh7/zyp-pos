"use client";

import { useTransition } from "react";
import { LogOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/actions/auth/logout";

export function LogoutButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => logoutAction())}
    >
      {pending ? <Loader2 className="animate-spin" /> : <LogOut className="size-4" />}
      <span className="hidden sm:inline">{pending ? "Signing out..." : "Logout"}</span>
    </Button>
  );
}