import "server-only";

import { connectDB } from "@/lib/db";
import { RestaurantModel } from "@/models/Restaurant";
import { SubscriptionModel } from "@/models/Subscription";
import { SubscriptionPaymentModel } from "@/models/SubscriptionPayment";
import { PlanModel } from "@/models/Plan";
import type { SubscriptionStatus } from "./constants";
import {
  refreshSubscriptionStatuses,
  toView,
  type SubscriptionView,
} from "./subscription-service";
import { localMonthRange, localYearRange } from "./date-utils";
import { listPlans } from "./plan-service";

export interface DashboardSubscriptionSlice {
  planId: string;
  planName: string;
  count: number;
  /** Paid subscriptions in this slice. */
  paidCount: number;
  /** Monthly-equivalent recurring revenue (paise, rounded). */
  mrrPaise: number;
}

export interface RevenueSnapshot {
  thisMonthPaise: number;
  thisYearPaise: number;
  totalPaise: number;
  paymentCountThisMonth: number;
}

export interface DashboardData {
  totals: {
    restaurants: number;
    activeRestaurants: number;
    suspendedRestaurants: number;
    plans: number;
    activePlans: number;
  };
  subscriptionCounts: Record<SubscriptionStatus, number>;
  /** Monhtly-equivalent recurring revenue across non-blocked subscriptions (paise). */
  mrrPaise: number;
  revenue: RevenueSnapshot;
  newRestaurantsThisMonth: number;
  byPlan: DashboardSubscriptionSlice[];
  expiringSoon: SubscriptionView[];
  expired: SubscriptionView[];
  pendingTrialEnd: SubscriptionView[];
}

export async function getDashboardData(): Promise<DashboardData> {
  await connectDB();
  await refreshSubscriptionStatuses();

  const now = new Date();
  const month = localMonthRange(now);
  const year = localYearRange(now);

  const [
    restaurants,
    activeRestaurants,
    plans,
    subsByStatus,
    mrrRows,
    revenueRows,
    newRestaurantCount,
    expiring,
    expired,
    trialEnd,
    sliceRows,
  ] = await Promise.all([
    RestaurantModel.countDocuments(),
    RestaurantModel.countDocuments({ isActive: true }),
    PlanModel.countDocuments(),
    SubscriptionModel.aggregate<{ _id: string; count: number }>([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    SubscriptionModel.aggregate<{
      _id: null;
      total: number;
      mrr: number;
    }>([
      {
        $match: { status: { $nin: ["EXPIRED", "SUSPENDED", "CANCELLED"] } },
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          mrr: {
            $sum: {
              $divide: [
                { $multiply: ["$finalPricePaise", 30] },
                {
                  $switch: {
                    branches: [
                      { case: { $eq: ["$billingCycle", "MONTHLY"] }, then: 30 },
                      { case: { $eq: ["$billingCycle", "QUARTERLY"] }, then: 90 },
                      { case: { $eq: ["$billingCycle", "HALF_YEARLY"] }, then: 180 },
                      { case: { $eq: ["$billingCycle", "YEARLY"] }, then: 365 },
                    ],
                    default: 30,
                  },
                },
              ],
            },
          },
        },
      },
    ]),
    SubscriptionPaymentModel.aggregate<{
      month: Array<{ total?: number; count?: number }>;
      year: Array<{ total?: number }>;
      allTime: Array<{ total?: number }>;
    }>([
      {
        $facet: {
          month: [
            { $match: { status: "PAID", paidAt: { $gte: month.from, $lt: month.to } } },
            { $group: { _id: null, total: { $sum: "$amountPaise" }, count: { $sum: 1 } } },
          ],
          year: [
            { $match: { status: "PAID", paidAt: { $gte: year.from, $lt: year.to } } },
            { $group: { _id: null, total: { $sum: "$amountPaise" } } },
          ],
          allTime: [
            { $match: { status: "PAID" } },
            { $group: { _id: null, total: { $sum: "$amountPaise" } } },
          ],
        },
      },
    ]),
    RestaurantModel.countDocuments({
      createdAt: { $gte: month.from, $lt: month.to },
    }),
    SubscriptionModel.find({ status: "EXPIRING" })
      .sort({ expiryDate: 1 })
      .limit(8)
      .lean(),
    SubscriptionModel.find({ status: "EXPIRED" })
      .sort({ expiryDate: 1 })
      .limit(8)
      .lean(),
    SubscriptionModel.find({
      status: { $in: ["TRIAL", "EXPIRING"] },
      expiryDate: { $lt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) },
    })
      .sort({ expiryDate: 1 })
      .limit(8)
      .lean(),
    SubscriptionModel.aggregate<{
      _id: string;
      count: number;
      paidCount: number;
      mrr: number;
    }>([
      {
        $match: { status: { $nin: ["EXPIRED", "SUSPENDED", "CANCELLED"] } },
      },
      {
        $group: {
          _id: "$planId",
          count: { $sum: 1 },
          paidCount: {
            $sum: {
              $cond: [{ $and: [{ $ne: ["$status", "TRIAL"] }] }, 1, 0],
            },
          },
          mrr: {
            $sum: {
              $divide: [
                { $multiply: ["$finalPricePaise", 30] },
                {
                  $switch: {
                    branches: [
                      { case: { $eq: ["$billingCycle", "MONTHLY"] }, then: 30 },
                      { case: { $eq: ["$billingCycle", "QUARTERLY"] }, then: 90 },
                      { case: { $eq: ["$billingCycle", "HALF_YEARLY"] }, then: 180 },
                      { case: { $eq: ["$billingCycle", "YEARLY"] }, then: 365 },
                    ],
                    default: 30,
                  },
                },
              ],
            },
          },
        },
      },
    ]),
  ]);

  const statusCounts: Record<SubscriptionStatus, number> = {
    NONE: 0,
    TRIAL: 0,
    ACTIVE: 0,
    EXPIRING: 0,
    GRACE_PERIOD: 0,
    EXPIRED: 0,
    SUSPENDED: 0,
    CANCELLED: 0,
  };
  for (const row of subsByStatus) {
    statusCounts[row._id as SubscriptionStatus] = row.count;
  }

  const mrrPaise = mrrRows[0]?.mrr ?? 0;

  const rev = revenueRows[0];
  const monthRow = rev?.month?.[0];
  const yearRow = rev?.year?.[0];
  const allTimeRow = rev?.allTime?.[0];
  const revenue: RevenueSnapshot = {
    thisMonthPaise: Math.round(monthRow?.total ?? 0),
    thisYearPaise: Math.round(yearRow?.total ?? 0),
    totalPaise: Math.round(allTimeRow?.total ?? 0),
    paymentCountThisMonth: Math.round(monthRow?.count ?? 0),
  };

  const activePlans = await listPlans({ includeInactive: false });

  const planNameById = new Map(activePlans.map((p) => [p.planId, p.name]));
  const byPlan: DashboardSubscriptionSlice[] = sliceRows
    .filter((row) => row._id)
    .map((row) => ({
      planId: String(row._id),
      planName: planNameById.get(String(row._id)) ?? "Plan",
      count: row.count,
      paidCount: row.paidCount,
      mrrPaise: Math.round(row.mrr ?? 0),
    }))
    .sort((a, b) => b.count - a.count);

  const [restaurantNames, plansMap] = await Promise.all([
    RestaurantModel.find().select("_id name").lean(),
    PlanModel.find().select("_id name").lean(),
  ]);
  const rNameById = new Map(restaurantNames.map((r) => [String(r._id), String(r.name)]));
  const pNameById = new Map(plansMap.map((p) => [String(p._id), String(p.name)]));
  const toSub = (sub: { restaurantId: unknown; planId: unknown }) =>
    toView(
      sub as Parameters<typeof toView>[0],
      rNameById.get(String(sub.restaurantId)) ?? "Restaurant",
      pNameById.get(String(sub.planId)) ?? "Plan",
      now
    );

  return {
    totals: {
      restaurants,
      activeRestaurants,
      suspendedRestaurants: restaurants - activeRestaurants,
      plans,
      activePlans: activePlans.length,
    },
    subscriptionCounts: statusCounts,
    mrrPaise,
    revenue,
    newRestaurantsThisMonth: newRestaurantCount,
    byPlan,
    expiringSoon: expiring.map(toSub),
    expired: expired.map(toSub),
    pendingTrialEnd: trialEnd.map(toSub),
  };
}