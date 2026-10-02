"use client";

import * as React from "react";
import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { businessTypes } from "@/lib/business-types";
import { UPI_ID_PLACEHOLDER } from "@/lib/settings/constants";
import { GST_RATE_PRESETS, GST_SCHEMES, GST_SCHEME_LABELS } from "@/lib/billing/constants";
import { updateSettingsAction, type SettingsActionState } from "@/actions/settings/actions";
import { LogoManager } from "./logo-manager";
import type { RestaurantSettingsSnapshot } from "@/lib/settings/settings-service";

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-sm text-destructive">{errors[0]}</p>;
}

function YesNo({
  name,
  value,
  onChange,
  disabled,
}: {
  name: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange(true)}
          disabled={disabled}
          className={`rounded-lg px-4 py-2 text-sm font-medium ring-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            value
              ? "bg-primary text-primary-foreground ring-primary"
              : "bg-background text-muted-foreground ring-border"
          }`}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          disabled={disabled}
          className={`rounded-lg px-4 py-2 text-sm font-medium ring-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            !value
              ? "bg-primary text-primary-foreground ring-primary"
              : "bg-background text-muted-foreground ring-border"
          }`}
        >
          No
        </button>
      </div>
      <input type="hidden" name={name} value={value ? "true" : "false"} />
    </>
  );
}

export function SettingsManager({
  snapshot,
  canEdit,
  gstRegistered,
}: {
  snapshot: RestaurantSettingsSnapshot;
  canEdit: boolean;
  gstRegistered: boolean;
}) {
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    updateSettingsAction,
    {}
  );

  const [businessType, setBusinessType] = useState(snapshot.restaurant.businessType);
  const [gst, setGst] = useState(snapshot.restaurant.gstRegistered);
  const [taxEnabled, setTaxEnabled] = useState(snapshot.tax.taxEnabled);
  const [taxInclusive, setTaxInclusive] = useState(snapshot.tax.taxInclusive);
  const [gstScheme, setGstScheme] = useState(snapshot.tax.gstScheme);
  const [defaultTaxRate, setDefaultTaxRate] = useState(String(snapshot.tax.defaultTaxRate));
  const [cgstRate, setCgstRate] = useState(String(snapshot.tax.cgstRatePercent));
  const [sgstRate, setSgstRate] = useState(String(snapshot.tax.sgstRatePercent));
  const [igstRate, setIgstRate] = useState(String(snapshot.tax.igstRatePercent));
  const [ratePreset, setRatePreset] = useState(
    (GST_RATE_PRESETS as readonly number[]).includes(snapshot.tax.defaultTaxRate)
      ? String(snapshot.tax.defaultTaxRate)
      : "custom"
  );
  const [serviceChargeEnabled, setServiceChargeEnabled] = useState(
    snapshot.billing.serviceChargeEnabled
  );
  const [roundOffEnabled, setRoundOffEnabled] = useState(snapshot.billing.roundOffEnabled);

  // The remaining text fields are controlled for the same reason. They used to
  // seed `defaultValue` straight from the snapshot, but a save revalidates
  // /settings, which re-renders this component with a fresh snapshot and
  // changes `defaultValue` on inputs that were already mounted. Base UI reads
  // that as an uncontrolled field mutating its default-value state after
  // initialization and warns. Reading the snapshot once into state keeps every
  // field controlled, so the form also keeps what the owner typed instead of
  // silently re-seeding itself mid-edit.
  const [name, setName] = useState(snapshot.restaurant.name ?? "");
  const [phone, setPhone] = useState(snapshot.restaurant.phone ?? "");
  const [email, setEmail] = useState(snapshot.restaurant.email ?? "");
  const [address, setAddress] = useState(snapshot.restaurant.address ?? "");
  const [city, setCity] = useState(snapshot.restaurant.city ?? "");
  const [stateName, setStateName] = useState(snapshot.restaurant.state ?? "");
  const [pincode, setPincode] = useState(snapshot.restaurant.pincode ?? "");
  const [gstin, setGstin] = useState(snapshot.restaurant.gstin ?? "");
  const [billPrefix, setBillPrefix] = useState(snapshot.billing.billPrefix ?? "");
  const [kotPrefix, setKotPrefix] = useState(snapshot.billing.kotPrefix ?? "");
  const [purchasePrefix, setPurchasePrefix] = useState(snapshot.billing.purchasePrefix ?? "");
  const [serviceChargeRate, setServiceChargeRate] = useState(
    String(snapshot.billing.serviceChargeRate ?? 0)
  );
  const [upiId, setUpiId] = useState(snapshot.billing.upiId ?? "");

  function applyPreset(value: string | null) {
    if (!value) return;
    setRatePreset(value);
    if (value === "custom") return;
    const rate = Number(value);
    setDefaultTaxRate(value);
    setCgstRate(String(rate / 2));
    setSgstRate(String(rate / 2));
    setIgstRate(value);
  }

  if (!canEdit) {
    return (
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Restaurant profile</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            <p className="font-medium">{snapshot.restaurant.name}</p>
            <p className="text-muted-foreground">
              {[snapshot.restaurant.address, snapshot.restaurant.city, snapshot.restaurant.state, snapshot.restaurant.pincode]
                .filter(Boolean)
                .join(", ")}
            </p>
            <p className="text-muted-foreground">
              {[snapshot.restaurant.phone, snapshot.restaurant.email].filter(Boolean).join(" · ")}
            </p>
            <p className="text-muted-foreground">
              {snapshot.restaurant.businessType} ·{" "}
              {gstRegistered ? `GST registered (${snapshot.restaurant.gstin})` : "Not GST registered"}
            </p>
          </CardContent>
        </Card>
        <ReadOnlyBilling snapshot={snapshot} />
        <LogoManager canEdit={false} logo={snapshot.logo} />
        <p className="text-sm text-muted-foreground">
          Only the restaurant owner or a manager can change these settings.
        </p>
      </div>
    );
  }

  return (
    <>
      <form action={formAction} className="grid gap-5">
      {state.message && (
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            state.success
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {state.message}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Restaurant profile</CardTitle>
          <CardDescription>
            Used on bills, KOT slips and purchase orders.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="name">Restaurant name</Label>
            <Input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} />
            <FieldError errors={state._errors?.name} />
          </div>
          <div className="grid gap-2">
            <Label>Business type</Label>
            <Select value={businessType} onValueChange={(v) => setBusinessType(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {businessTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="businessType" value={businessType} />
            <FieldError errors={state._errors?.businessType} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <FieldError errors={state._errors?.phone} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <FieldError errors={state._errors?.email} />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="address">Address</Label>
            <Input
              id="address"
              name="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
            <FieldError errors={state._errors?.address} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="city">City</Label>
            <Input id="city" name="city" value={city} onChange={(e) => setCity(e.target.value)} />
            <FieldError errors={state._errors?.city} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="state">State</Label>
            <Input
              id="state"
              name="state"
              value={stateName}
              onChange={(e) => setStateName(e.target.value)}
            />
            <FieldError errors={state._errors?.state} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pincode">Pincode</Label>
            <Input
              id="pincode"
              name="pincode"
              value={pincode}
              onChange={(e) => setPincode(e.target.value)}
            />
            <FieldError errors={state._errors?.pincode} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>GST registration</CardTitle>
          <CardDescription>
            GST registration is the master switch: an unregistered restaurant never charges tax.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label>GST registered?</Label>
            <YesNo name="gstRegistered" value={gst} onChange={setGst} />
          </div>
          {gst && (
            <div className="grid gap-2">
              <Label htmlFor="gstin">GSTIN</Label>
              <Input
                id="gstin"
                name="gstin"
                value={gstin}
                onChange={(e) => setGstin(e.target.value)}
                placeholder="22AAAAA0000A1Z5"
              />
              <FieldError errors={state._errors?.gstin} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tax configuration</CardTitle>
          <CardDescription>
            Applies to new bills. Existing bills keep the rates they were generated with.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label>Charge tax?</Label>
            <YesNo
              name="taxEnabled"
              value={gst && taxEnabled}
              onChange={setTaxEnabled}
              disabled={!gst}
            />
            {!gst && (
              <p className="text-xs text-muted-foreground">
                Register for GST to enable taxation.
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label>Tax inclusive prices?</Label>
            <YesNo name="taxInclusive" value={taxInclusive} onChange={setTaxInclusive} />
          </div>
          <div className="grid gap-2">
            <Label>GST scheme</Label>
            <Select value={gstScheme} onValueChange={(v) => setGstScheme(v ?? "INTRA_STATE")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GST_SCHEMES.map((scheme) => (
                  <SelectItem key={scheme} value={scheme}>
                    {GST_SCHEME_LABELS[scheme]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="gstScheme" value={gstScheme} />
            <FieldError errors={state._errors?.gstScheme} />
          </div>
          <div className="grid gap-2">
            <Label>Default rate preset</Label>
            <Select value={ratePreset} onValueChange={applyPreset}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GST_RATE_PRESETS.map((r) => (
                  <SelectItem key={r} value={String(r)}>
                    {r}%
                  </SelectItem>
                ))}
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="defaultTaxRate">Default tax rate (%)</Label>
            <Input
              id="defaultTaxRate"
              name="defaultTaxRate"
              inputMode="decimal"
              value={defaultTaxRate}
              onChange={(e) => {
                setDefaultTaxRate(e.target.value);
                setRatePreset("custom");
              }}
            />
            <FieldError errors={state._errors?.defaultTaxRate} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="cgstRatePercent">CGST (%)</Label>
            <Input
              id="cgstRatePercent"
              name="cgstRatePercent"
              inputMode="decimal"
              value={cgstRate}
              onChange={(e) => setCgstRate(e.target.value)}
            />
            <FieldError errors={state._errors?.cgstRatePercent} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sgstRatePercent">SGST (%)</Label>
            <Input
              id="sgstRatePercent"
              name="sgstRatePercent"
              inputMode="decimal"
              value={sgstRate}
              onChange={(e) => setSgstRate(e.target.value)}
            />
            <FieldError errors={state._errors?.sgstRatePercent} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="igstRatePercent">IGST (%)</Label>
            <Input
              id="igstRatePercent"
              name="igstRatePercent"
              inputMode="decimal"
              value={igstRate}
              onChange={(e) => setIgstRate(e.target.value)}
            />
            <FieldError errors={state._errors?.igstRatePercent} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Billing and numbering</CardTitle>
          <CardDescription>
            Numbering prefixes, service charge and round-off. Currency is {snapshot.billing.currency}.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="billPrefix">Bill number prefix</Label>
            <Input
              id="billPrefix"
              name="billPrefix"
              value={billPrefix}
              onChange={(e) => setBillPrefix(e.target.value)}
              placeholder="BILL"
            />
            <p className="text-xs text-muted-foreground">Letters and numbers only.</p>
            <FieldError errors={state._errors?.billPrefix} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="kotPrefix">KOT number prefix</Label>
            <Input
              id="kotPrefix"
              name="kotPrefix"
              value={kotPrefix}
              onChange={(e) => setKotPrefix(e.target.value)}
              placeholder="KOT"
            />
            <FieldError errors={state._errors?.kotPrefix} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="purchasePrefix">Purchase number prefix</Label>
            <Input
              id="purchasePrefix"
              name="purchasePrefix"
              value={purchasePrefix}
              onChange={(e) => setPurchasePrefix(e.target.value)}
              placeholder="PUR"
            />
            <FieldError errors={state._errors?.purchasePrefix} />
          </div>
          <div className="grid gap-2">
            <Label>Charge service charge?</Label>
            <YesNo
              name="serviceChargeEnabled"
              value={serviceChargeEnabled}
              onChange={setServiceChargeEnabled}
            />
          </div>
          {serviceChargeEnabled && (
            <div className="grid gap-2">
              <Label htmlFor="serviceChargeRate">Service charge (%)</Label>
              <Input
                id="serviceChargeRate"
                name="serviceChargeRate"
                inputMode="decimal"
                value={serviceChargeRate}
                onChange={(e) => setServiceChargeRate(e.target.value)}
              />
              <FieldError errors={state._errors?.serviceChargeRate} />
            </div>
          )}
          <div className="grid gap-2">
            <Label>Round off totals?</Label>
            <YesNo
              name="roundOffEnabled"
              value={roundOffEnabled}
              onChange={setRoundOffEnabled}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment</CardTitle>
          <CardDescription>
            Printed as a &ldquo;Scan to Pay&rdquo; QR code on the customer&apos;s bill, prefilled with
            the bill amount. Leave empty to print bills without a QR.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="upiId">UPI ID</Label>
            <Input
              id="upiId"
              name="upiId"
              type="text"
              inputMode="email"
              autoComplete="off"
              spellCheck={false}
              placeholder={UPI_ID_PLACEHOLDER}
              value={upiId}
              onChange={(e) => setUpiId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              In the form restaurantname@provider. Scanning the bill&apos;s QR opens the payment
              app with this ID and the bill total prefilled.
            </p>
            <FieldError errors={state._errors?.upiId} />
          </div>
        </CardContent>
      </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Save settings
          </Button>
          <Button
            type="submit"
            name="clearUpiId"
            value="true"
            variant="outline"
            disabled={pending || !snapshot.billing.upiId}
          >
            Clear UPI ID
          </Button>
        </div>
      </form>

      <div className="mt-5">
        <LogoManager canEdit logo={snapshot.logo} />
      </div>
    </>
  );
}

function ReadOnlyBilling({ snapshot }: { snapshot: RestaurantSettingsSnapshot }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Billing and numbering</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1 text-sm text-muted-foreground">
        <p>
          Tax: {snapshot.tax.taxEnabled ? `enabled at ${snapshot.tax.defaultTaxRate}%` : "disabled"} ·{" "}
          {snapshot.tax.gstScheme === "INTER_STATE" ? "IGST" : "CGST + SGST"} ·{" "}
          {snapshot.tax.taxInclusive ? "inclusive" : "exclusive"}
        </p>
        <p>
          Prefixes: bill {snapshot.billing.billPrefix}, KOT {snapshot.billing.kotPrefix}, purchase{" "}
          {snapshot.billing.purchasePrefix}
        </p>
        <p>
          Service charge {snapshot.billing.serviceChargeEnabled ? `${snapshot.billing.serviceChargeRate}%` : "off"} ·
          round off {snapshot.billing.roundOffEnabled ? "on" : "off"} · {snapshot.billing.currency}
        </p>
        <p>
          UPI ID: {snapshot.billing.upiId || "not set (no QR on bills)"}
        </p>
      </CardContent>
    </Card>
  );
}
