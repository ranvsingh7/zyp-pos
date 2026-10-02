import { type Metadata } from "next";
import Link from "next/link";
import { UtensilsCrossed } from "lucide-react";
import { RestaurantOnboardingForm } from "@/components/onboarding/restaurant-form";

export const metadata: Metadata = {
  title: "Get Started | ZYP POS",
  description: "Set up your restaurant in ZYP POS.",
};

export default function OnboardingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b px-6 py-4">
        <Link href="/" className="inline-flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <UtensilsCrossed className="size-4" />
          </span>
          <span className="font-heading text-lg font-semibold tracking-tight">ZYP POS</span>
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <div className="mb-10">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Get Started with ZYP POS
          </h1>
          <p className="mt-2 text-muted-foreground">
            Tell us a little about your restaurant.
          </p>
        </div>
        <RestaurantOnboardingForm />
      </main>
    </div>
  );
}