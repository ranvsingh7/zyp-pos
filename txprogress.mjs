import { MongoClient, ObjectId } from "mongodb";
import { config } from "dotenv";
config({ path: ".env.local" });
const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db(process.env.MONGODB_DB_NAME || "restopos");
const rid = new ObjectId("6abeaccefeadc0416b5174f9");
const s = { restaurantId: rid };
const out = {};
for (const col of ["orders", "kitchenordertickets", "bills", "payments"]) {
  out[col] = await db.collection(col).countDocuments(s);
}
out.status = await db.collection("orders").aggregate([{ $match: s }, { $group: { _id: "$status", n: { $sum: 1 } } }]).toArray();
out.occupied = await db.collection("restauranttables").countDocuments({ restaurantId: rid, status: { $ne: "AVAILABLE" } });
console.log(JSON.stringify(out));
await c.close();
