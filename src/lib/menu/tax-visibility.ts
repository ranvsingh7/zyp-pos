import {
  normalizeTaxOverride,
  type TaxOverrideConfig,
} from "@/lib/billing/tax-config";

export interface TaxOverrideFormPart {
  taxOverrideEnabled: boolean;
  taxRatePercent: string;
  taxMode: string;
  taxType: string;
}

/**
 * Maps the raw form fields to the API tax-override payload. When the override
 * toggle is off the stored override is cleared (registered restaurants only —
 * see {@link resolveTaxOverridePayload} for the GST gating wrapper).
 */
export function toTaxOverridePayload(
  part: TaxOverrideFormPart
): TaxOverrideConfig {
  if (!part.taxOverrideEnabled) {
    return { enabled: false, taxRatePercent: null, taxMode: null, taxType: null };
  }
  return {
    enabled: true,
    taxRatePercent:
      part.taxRatePercent === "" ? null : Number(part.taxRatePercent),
    taxMode:
      part.taxMode === "INCLUSIVE" || part.taxMode === "EXCLUSIVE"
        ? part.taxMode
        : null,
    taxType:
      part.taxType === "CGST_SGST" || part.taxType === "IGST" ? part.taxType : null,
  };
}

/**
 * Resolves the tax-override payload to send on save.
 *
 * GST is only meaningful when the restaurant is effectively GST-enabled
 * (registered AND tax on). When it is not, the forms hide the override
 * controls entirely, and this keeps whatever override the document already
 * carries so editing an item never erases stored tax data — billing ignores
 * overrides for unregistered restaurants regardless.
 */
export function resolveTaxOverridePayload(
  gstEnabled: boolean,
  existing: TaxOverrideConfig | null | undefined,
  form: TaxOverrideFormPart
): TaxOverrideConfig {
  if (gstEnabled) return toTaxOverridePayload(form);
  return normalizeTaxOverride(existing);
}

/**
 * Resolves the HSN/SAC payload to send on save.
 *
 * Mirrors the tax-override gating: the field is only offered to GST-enabled
 * restaurants, and when it is hidden we keep whatever the document already
 * carries so editing an item never silently wipes a code that was configured
 * while GST was on. A blank form value clears the code.
 */
export function resolveHsnSacPayload(
  gstEnabled: boolean,
  existing: string | null | undefined,
  formValue: string
): string | undefined {
  if (!gstEnabled) return existing?.trim() || undefined;
  return formValue.trim() || undefined;
}