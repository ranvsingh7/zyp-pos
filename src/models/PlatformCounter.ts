import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";

/**
 * Atomic platform counters. Used to mint collision-safe sequential numbers for
 * invoices today (e.g. SUB-000001). The single-document $inc guarantees no two
 * concurrent requests can observe the same value.
 */
const platformCounterSchema = new Schema({
  key: {
    type: String,
    required: true,
    unique: true,
  },
  value: {
    type: Number,
    required: true,
    default: 0,
  },
});

export type PlatformCounter = InferSchemaType<typeof platformCounterSchema>;

export const PlatformCounterModel =
  (models.PlatformCounter as Model<PlatformCounter>) ||
  model<PlatformCounter>("PlatformCounter", platformCounterSchema);