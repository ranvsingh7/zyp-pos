import { describe, it, expect } from "vitest";
import {
  signupSchema,
  loginSchema,
  restaurantRegistrationSchema,
} from "./validations";

describe("signupSchema", () => {
  const validSignup = {
    fullName: "Anshul Sharma",
    email: "anshul@example.com",
    password: "Password123!",
    confirmPassword: "Password123!",
  };

  it("accepts valid signup data", () => {
    const result = signupSchema.safeParse(validSignup);
    expect(result.success).toBe(true);
  });

  it("rejects empty full name", () => {
    const result = signupSchema.safeParse({ ...validSignup, fullName: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = signupSchema.safeParse({ ...validSignup, email: "notanemail" });
    expect(result.success).toBe(false);
  });

  it("rejects password shorter than 8 characters", () => {
    const result = signupSchema.safeParse({
      ...validSignup,
      password: "Short1!",
      confirmPassword: "Short1!",
    });
    expect(result.success).toBe(false);
  });

  it("rejects mismatched passwords", () => {
    const result = signupSchema.safeParse({
      ...validSignup,
      confirmPassword: "Different123!",
    });
    expect(result.success).toBe(false);
  });

  it("trims whitespace from email", () => {
    const result = signupSchema.safeParse({
      ...validSignup,
      email: "  anshul@example.com  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("anshul@example.com");
    }
  });
});

describe("loginSchema", () => {
  it("accepts valid login credentials", () => {
    const result = loginSchema.safeParse({
      email: "anshul@example.com",
      password: "Password123!",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = loginSchema.safeParse({
      email: "not-an-email",
      password: "Password123!",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty password", () => {
    const result = loginSchema.safeParse({
      email: "anshul@example.com",
      password: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("restaurantRegistrationSchema", () => {
  const validRestaurant = {
    name: "Curry House",
    ownerName: "Anshul Sharma",
    phone: "9876543210",
    email: "curry@example.com",
    address: "123 Food Street",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400001",
    gstRegistered: false,
    gstin: "",
    businessType: "Restaurant" as const,
  };

  it("accepts valid restaurant data (non-GST)", () => {
    const result = restaurantRegistrationSchema.safeParse(validRestaurant);
    expect(result.success).toBe(true);
  });

  it("accepts valid restaurant data (GST-registered with valid GSTIN)", () => {
    const result = restaurantRegistrationSchema.safeParse({
      ...validRestaurant,
      gstRegistered: true,
      gstin: "22AAAAA0000A1Z5",
    });
    expect(result.success).toBe(true);
  });

  it("rejects GST-registered restaurant without GSTIN", () => {
    const result = restaurantRegistrationSchema.safeParse({
      ...validRestaurant,
      gstRegistered: true,
      gstin: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid GSTIN format", () => {
    const result = restaurantRegistrationSchema.safeParse({
      ...validRestaurant,
      gstRegistered: true,
      gstin: "INVALID-GSTIN",
    });
    expect(result.success).toBe(false);
  });

  it("requires restaurant name", () => {
    const result = restaurantRegistrationSchema.safeParse({
      ...validRestaurant,
      name: "",
    });
    expect(result.success).toBe(false);
  });

  it("requires phone number", () => {
    const result = restaurantRegistrationSchema.safeParse({
      ...validRestaurant,
      phone: "",
    });
    expect(result.success).toBe(false);
  });

  it("requires business type", () => {
    const result = restaurantRegistrationSchema.safeParse({
      ...validRestaurant,
      businessType: "Invalid Type",
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid business types", () => {
    const types = [
      "Restaurant",
      "Cafe",
      "Fast Food",
      "Bakery",
      "Cloud Kitchen",
      "Other",
    ] as const;
    for (const type of types) {
      const result = restaurantRegistrationSchema.safeParse({
        ...validRestaurant,
        businessType: type,
      });
      expect(result.success).toBe(true);
    }
  });

  it("normalizes GSTIN to uppercase", () => {
    const result = restaurantRegistrationSchema.safeParse({
      ...validRestaurant,
      gstRegistered: true,
      gstin: "22aaaaa0000a1z5",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gstin).toBe("22AAAAA0000A1Z5");
    }
  });
});

describe("GSTIN validation", () => {
  const baseData = {
    name: "Test",
    ownerName: "Owner",
    phone: "9876543210",
    address: "123 Street",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400001",
    gstRegistered: true,
    businessType: "Restaurant" as const,
  };

  it("accepts valid 15-character GSTIN", () => {
    const result = restaurantRegistrationSchema.safeParse({
      ...baseData,
      gstin: "22AAAAA0000A1Z5",
    });
    expect(result.success).toBe(true);
  });

  it("rejects GSTIN shorter than 15 characters", () => {
    const result = restaurantRegistrationSchema.safeParse({
      ...baseData,
      gstin: "22AAAAA0000",
    });
    expect(result.success).toBe(false);
  });

  it("rejects GSTIN with special characters", () => {
    const result = restaurantRegistrationSchema.safeParse({
      ...baseData,
      gstin: "22AAAAA0000A1Z@",
    });
    expect(result.success).toBe(false);
  });
});