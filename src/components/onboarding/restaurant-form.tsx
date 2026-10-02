"use client";

import { useState } from "react";
import { useActionState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  onboardingAction,
  type OnboardingFormState,
} from "@/actions/onboarding";
import { businessTypes } from "@/lib/business-types";

export function RestaurantOnboardingForm() {
  const [state, formAction, pending] = useActionState<OnboardingFormState, FormData>(
    onboardingAction,
    {}
  );
  const [gstRegistered, setGstRegistered] = useState(false);
  const [businessType, setBusinessType] = useState<string | null>(null);

  return (
    <form action={formAction} className="grid gap-6" noValidate>
      {state.message && (
        <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </div>
      )}

      <input type="hidden" name="gstRegistered" value={gstRegistered ? "true" : "false"} />
      <input type="hidden" name="businessType" value={businessType ?? ""} />

      <div className="grid gap-6 md:grid-cols-2">
        {/* Restaurant Name */}
        <div className="grid gap-2">
          <Label htmlFor="name">Restaurant Name *</Label>
          <Input id="name" name="name" placeholder="e.g. Curry House" aria-invalid={Boolean(state._errors?.name)} />
          {state._errors?.name && <p className="text-sm text-destructive">{state._errors.name[0]}</p>}
        </div>

        {/* Owner Name */}
        <div className="grid gap-2">
          <Label htmlFor="ownerName">Owner Name *</Label>
          <Input id="ownerName" name="ownerName" placeholder="e.g. Anshul Sharma" aria-invalid={Boolean(state._errors?.ownerName)} />
          {state._errors?.ownerName && <p className="text-sm text-destructive">{state._errors.ownerName[0]}</p>}
        </div>

        {/* Phone */}
        <div className="grid gap-2">
          <Label htmlFor="phone">Phone Number *</Label>
          <Input id="phone" name="phone" placeholder="e.g. 9876543210" aria-invalid={Boolean(state._errors?.phone)} />
          {state._errors?.phone && <p className="text-sm text-destructive">{state._errors.phone[0]}</p>}
        </div>

        {/* Email */}
        <div className="grid gap-2">
          <Label htmlFor="email">Email (optional)</Label>
          <Input id="email" name="email" type="email" placeholder="restaurant@example.com" aria-invalid={Boolean(state._errors?.email)} />
          {state._errors?.email && <p className="text-sm text-destructive">{state._errors.email[0]}</p>}
        </div>
      </div>

      {/* Address */}
      <div className="grid gap-2">
        <Label htmlFor="address">Address *</Label>
        <Input id="address" name="address" placeholder="Street address" aria-invalid={Boolean(state._errors?.address)} />
        {state._errors?.address && <p className="text-sm text-destructive">{state._errors.address[0]}</p>}
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* City */}
        <div className="grid gap-2">
          <Label htmlFor="city">City *</Label>
          <Input id="city" name="city" placeholder="e.g. Mumbai" aria-invalid={Boolean(state._errors?.city)} />
          {state._errors?.city && <p className="text-sm text-destructive">{state._errors.city[0]}</p>}
        </div>

        {/* State */}
        <div className="grid gap-2">
          <Label htmlFor="state">State *</Label>
          <Input id="state" name="state" placeholder="e.g. Maharashtra" aria-invalid={Boolean(state._errors?.state)} />
          {state._errors?.state && <p className="text-sm text-destructive">{state._errors.state[0]}</p>}
        </div>

        {/* Pincode */}
        <div className="grid gap-2">
          <Label htmlFor="pincode">Pincode *</Label>
          <Input id="pincode" name="pincode" placeholder="e.g. 400001" aria-invalid={Boolean(state._errors?.pincode)} />
          {state._errors?.pincode && <p className="text-sm text-destructive">{state._errors.pincode[0]}</p>}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* GST Registered */}
        <div className="grid gap-2">
          <Label>GST Registered? *</Label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setGstRegistered(true)}
              className={`rounded-lg px-4 py-2 text-sm font-medium ring-1 transition-colors ${
                gstRegistered
                  ? "bg-primary text-primary-foreground ring-primary"
                  : "bg-background text-muted-foreground ring-border hover:ring-foreground/20"
              }`}
            >
              YES
            </button>
            <button
              type="button"
              onClick={() => setGstRegistered(false)}
              className={`rounded-lg px-4 py-2 text-sm font-medium ring-1 transition-colors ${
                !gstRegistered
                  ? "bg-primary text-primary-foreground ring-primary"
                  : "bg-background text-muted-foreground ring-border hover:ring-foreground/20"
              }`}
            >
              NO
            </button>
          </div>
        </div>

        {/* GSTIN */}
        <div className="grid gap-2">
          <Label htmlFor="gstin">GSTIN {gstRegistered && <span className="text-destructive">*</span>}</Label>
          <Input
            id="gstin"
            name="gstin"
            placeholder="22AAAAA0000A1Z5"
            disabled={!gstRegistered}
            aria-invalid={Boolean(state._errors?.gstin)}
          />
          {state._errors?.gstin && <p className="text-sm text-destructive">{state._errors.gstin[0]}</p>}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Business Type */}
        <div className="grid gap-2">
          <Label>Business Type *</Label>
          <input type="hidden" name="businessType" value={businessType ?? ""} />
          <Select value={businessType ?? ""} onValueChange={setBusinessType}>
            <SelectTrigger className="w-full" aria-invalid={Boolean(state._errors?.businessType)}>
              <SelectValue placeholder="Select business type" />
            </SelectTrigger>
            <SelectContent>
              {businessTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {state._errors?.businessType && <p className="text-sm text-destructive">{state._errors.businessType[0]}</p>}
        </div>

        {/* Logo (UI only for now) */}
        <div className="grid gap-2">
          <Label>Restaurant Logo (optional)</Label>
          <div className="flex items-center justify-center rounded-lg border-2 border-dashed border-border p-4 text-center transition-colors hover:border-muted-foreground/30">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Upload className="size-5" />
              <span className="text-xs">Cloud storage available in a future update</span>
            </div>
          </div>
        </div>
      </div>

      <Button type="submit" disabled={pending} className="w-full md:w-auto">
        {pending && <Loader2 className="animate-spin" />}
        {pending ? "Setting up your restaurant..." : "Complete Setup"}
      </Button>
    </form>
  );
}