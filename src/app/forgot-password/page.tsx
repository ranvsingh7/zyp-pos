import { type Metadata } from "next";
import Link from "next/link";
import { UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Forgot Password | ZYP POS",
};

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8 flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <UtensilsCrossed className="size-4" />
        </span>
        <span className="font-heading text-lg font-semibold tracking-tight">ZYP POS</span>
      </Link>

      <div className="w-full max-w-sm rounded-xl border bg-card p-6 text-center">
        <h1 className="font-heading text-xl font-semibold tracking-tight">Forgot password</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Password reset links will be available in an upcoming update. For now, contact your
          restaurant administrator for help.
        </p>
        <Link href="/login">
          <Button className="mt-6 w-full" variant="outline">
            Back to Login
          </Button>
        </Link>
      </div>
    </div>
  );
}