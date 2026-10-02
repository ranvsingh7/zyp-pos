"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { loginAction, type LoginFormState } from "@/actions/auth/login";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginFormState, FormData>(
    loginAction,
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
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/forgot-password"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Forgot password?
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          aria-invalid={Boolean(state._errors?.password)}
        />
        {state._errors?.password && (
          <p className="text-sm text-destructive">{state._errors.password[0]}</p>
        )}
      </div>

      <Button type="submit" disabled={pending} className="mt-2 w-full">
        {pending && <Loader2 className="animate-spin" />}
        {pending ? "Signing in..." : "Login"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="font-medium text-foreground hover:underline">
          Create Account
        </Link>
      </p>
    </form>
  );
}