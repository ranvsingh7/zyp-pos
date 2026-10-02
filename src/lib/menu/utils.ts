import mongoose from "mongoose";
import { OBJECT_ID_REGEX } from "@/lib/menu/constants";

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive exact-name matcher used for duplicate checks. */
export function exactCaseInsensitiveRegex(value: string): RegExp {
  return new RegExp(`^${escapeRegExp(value)}$`, "i");
}

export function toObjectId(value: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(value);
}

export function isValidObjectId(value: string): boolean {
  return OBJECT_ID_REGEX.test(value);
}