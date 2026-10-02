"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { signupAction, type FormState } from "@/actions/auth/signup";

export function SignupForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    signupAction,
    {}
  );

  return (
    <form action={formAction} className="grid gap-4" noValidate>
      {state.message && (
        <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </div>
      )}

      <div className="grid gap-2">
        <Label htmlFor="fullName">Full Name</Label>
        <Input
          id="fullName"
          name="fullName"
          type="text"
          autoComplete="name"
          placeholder="Anshul Sharma"
          defaultValue={state.fields?.fullName}
          aria-invalid={Boolean(state._errors?.fullName)}
        />
        {state._errors?.fullName && (
          <p className="text-sm text-destructive">{state._errors.fullName[0]}</p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          defaultValue={state.fields?.email}
          aria-invalid={Boolean(state._errors?.email)}
        />
        {state._errors?.email && (
          <p className="text-sm text-destructive">{state._errors.email[0]}</p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="Min. 8 characters"
          aria-invalid={Boolean(state._errors?.password)}
        />
        {state._errors?.password && (
          <p className="text-sm text-destructive">{state._errors.password[0]}</p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="confirmPassword">Confirm Password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          placeholder="Re-enter password"
          aria-invalid={Boolean(state._errors?.confirmPassword)}
        />
        {state._errors?.confirmPassword && (
          <p className="text-sm text-destructive">
            {state._errors.confirmPassword[0]}
          </p>
        )}
      </div>

      <Button type="submit" disabled={pending} className="mt-2 w-full">
        {pending && <Loader2 className="animate-spin" />}
        {pending ? "Creating account..." : "Create Account"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground hover:underline">
          Login
        </Link>
      </p>
    </form>
  );
}