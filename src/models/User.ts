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
  },
  {
    timestamps: true,
  }
);

userSchema.index({ restaurantId: 1 });

export type User = InferSchemaType<typeof userSchema>;

export const UserModel =
  (models.User as Model<User>) || model<User>("User", userSchema);