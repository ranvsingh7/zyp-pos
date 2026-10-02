import Link from "next/link";
import { UtensilsCrossed, ArrowRight, CreditCard, Users, BarChart3, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <UtensilsCrossed className="size-4" />
          </span>
          <span className="font-heading text-lg font-semibold tracking-tight">ZYP POS</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login">
            <Button variant="ghost" size="sm">Login</Button>
          </Link>
          <Link href="/signup">
            <Button size="sm">Get Started</Button>
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto flex max-w-5xl flex-col items-center px-6 py-24 text-center">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            Simple &middot; Fast &middot; Reliable
          </div>
          <h1 className="font-heading text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
            Run Your Restaurant Smarter
          </h1>
          <p className="mt-4 max-w-xl text-base text-muted-foreground sm:text-lg">
            Simple, fast and reliable restaurant management.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/signup">
              <Button size="lg">
                Get Started
                <ArrowRight className="size-4" />
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="outline" size="lg">Login</Button>
            </Link>
          </div>
        </section>

        <section className="border-t bg-muted/30 px-6 py-20">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
              Everything you need to run your restaurant
            </h2>
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: CreditCard, title: "POS & Billing", desc: "Fast, accurate billing with GST support." },
                { icon: Users, title: "Table Management", desc: "Track tables and orders in real-time." },
                { icon: BarChart3, title: "Reports & Analytics", desc: "Understand your business with clear insights." },
                { icon: Settings, title: "Multi-outlet Ready", desc: "Scale your operations with ease." },
              ].map(({ icon: Icon, title, desc }) => (
                <div key={title} className="rounded-xl border bg-card p-5 shadow-sm">
                  <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-muted">
                    <Icon className="size-4 text-muted-foreground" />
                  </div>
                  <h3 className="font-heading text-sm font-medium">{title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-6 py-20">
          <div className="mx-auto max-w-3xl rounded-2xl bg-primary p-10 text-center text-primary-foreground">
            <h2 className="font-heading text-2xl font-semibold">Ready to get started?</h2>
            <p className="mt-2 text-sm opacity-90">
              Set up your restaurant in minutes, not days.
            </p>
            <Link href="/signup">
              <Button variant="secondary" size="lg" className="mt-6">
                Get Started Free
                <ArrowRight className="size-4" />
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t px-6 py-5 text-center text-sm text-muted-foreground">
        &copy; {new Date().getFullYear()} ZYP POS. All rights reserved.
      </footer>
    </div>
  );
}