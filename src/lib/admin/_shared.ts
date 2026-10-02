import "server-only";

import mongoose from "mongoose";

function deploymentSupportsTransactions(): boolean {
  try {
    if (mongoose.connection.readyState !== 1) return false;
    const client = mongoose.connection.getClient() as unknown as {
      topology?: { description?: { type?: string } };
    };
    const type = client.topology?.description?.type;
    return (
      type === "ReplicaSetNoPrimary" ||
      type === "ReplicaSetWithPrimary" ||
      type === "Sharded"
    );
  } catch {
    return false;
  }
}

/**
 * Runs `work` inside a MongoDB transaction when the deployment supports it and
 * falls back to plain sequential execution on standalone mongod (e.g. Atlas
 * M0). Captures the standard warning/failure path used across the app.
 */
export async function runInTransaction<T>(
  work: (session: mongoose.ClientSession | undefined) => Promise<T>
): Promise<T> {
  if (!deploymentSupportsTransactions()) {
    return work(undefined);
  }
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async (tx) => {
      result = await work(tx);
    });
    return result as T;
  } finally {
    await session.endSession();
  }
}