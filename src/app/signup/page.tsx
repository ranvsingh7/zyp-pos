import { type Metadata } from "next";
import Link from "next/link";
import { UtensilsCrossed } from "lucide-react";
import { SignupForm } from "@/components/auth/signup-form";

export const metadata: Metadata = {
  title: "Signup | ZYP POS",
  description: "Create a new ZYP POS account.",
};

export default function SignupPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8 flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <UtensilsCrossed className="size-4" />
        </span>
        <span className="font-heading text-lg font-semibold tracking-tight">ZYP POS</span>
      </Link>

      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="font-heading text-xl font-semibold tracking-tight">Create your account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Get started with ZYP POS for free.
          </p>
        </div>
        <SignupForm />
      </div>
    </div>
  );
}