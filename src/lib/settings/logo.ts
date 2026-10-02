import { LOGO_MIME_TYPES, LOGO_MAX_BYTES, type LogoMimeType } from "./constants";

/**
 * Detects the real image type from the file's leading bytes. The browser's
 * `File.type` and the multipart part's Content-Type are attacker-controlled,
 * so the server must never trust either one — only the magic bytes.
 */
export function detectLogoMimeType(bytes: Uint8Array): LogoMimeType | null {
  if (bytes.length >= 8) {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    ) {
      return "image/png";
    }
  }
  // WebP: "RIFF" <4 byte little-endian size> "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

export interface LogoValidationResult {
  ok: boolean;
  mimeType?: LogoMimeType;
  size: number;
  error?: string;
}

/** Shared size + magic-byte gate used by both the client form and the API. */
export function validateLogoBytes(
  bytes: Uint8Array,
  declaredType?: string | null
): LogoValidationResult {
  const size = bytes.byteLength;
  if (size === 0) {
    return { ok: false, size, error: "Choose an image to upload." };
  }
  if (size > LOGO_MAX_BYTES) {
    return { ok: false, size, error: "Logo must be 2 MB or smaller." };
  }
  const detected = detectLogoMimeType(bytes);
  if (!detected) {
    return { ok: false, size, error: "Only PNG, JPEG or WebP images are supported." };
  }
  // A declared type that disagrees with the bytes is rejected rather than
  // silently coerced: it means the request was crafted, not merely mislabelled.
  if (
    declaredType &&
    declaredType !== "application/octet-stream" &&
    declaredType !== detected &&
    !(declaredType === "image/jpg" && detected === "image/jpeg")
  ) {
    return {
      ok: false,
      size,
      error: "The uploaded file contents do not match its file type.",
    };
  }
  return { ok: true, mimeType: detected, size };
}

export function isSupportedLogoMimeType(value: string): value is LogoMimeType {
  return (LOGO_MIME_TYPES as readonly string[]).includes(value);
}
