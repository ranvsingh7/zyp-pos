import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";

const userSchema = new Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    phone: {
      type: String,
      trim: true,
    },
    role: {
      type: String,
      enum: ["OWNER", "MANAGER", "CASHIER", "WAITER", "SUPER_ADMIN"],
      default: "OWNER",
    },
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    /**
     * Session-token generation counter. Sessions are stateless signed JWTs, so
     * there is no server-side token record to delete; this field is the
     * invalidation lever instead. The value is stamped into the JWT at login and
     * re-checked against the database on every authenticated request by
     * `loadUser()`. Incrementing it invalidates every previously issued session
     * for exactly that one user and no one else — which is what a credential
     * change needs (old sessions must not survive a password reset) without
     * needing a second auth system or a global secret rotation.
     *
     * Absent/undefined documents read as 0, so existing accounts and tokens
     * minted before this field existed keep working unchanged.
     */
    tokenVersion: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.index({ restaurantId: 1 });

export type User = InferSchemaType<typeof userSchema>;

export const UserModel =
  (models.User as Model<User>) || model<User>("User", userSchema);