import { PrismaClient } from "@prisma/client";
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Vercel's deployment filesystem is read-only, and SQLite wants a writable
 * directory next to the database file even when every query is a read. /tmp
 * is the one writable path in the runtime, so on a cold start we copy the
 * committed, pre-seeded snapshot there and point Prisma at the copy.
 *
 * Locally (and in the seed script, which does write) this is a no-op and the
 * DATABASE_URL from .env is used unchanged.
 */
function resolveDatabaseUrl(): string {
  const bundledPath = path.join(process.cwd(), "prisma", "dev.db");

  if (process.env.VERCEL) {
    const writablePath = "/tmp/risklens.db";
    if (!existsSync(writablePath)) {
      copyFileSync(bundledPath, writablePath);
    }
    return `file:${writablePath}`;
  }

  // Fall back to the bundled path rather than throwing if DATABASE_URL is
  // unset, so a fresh clone still renders before anyone copies .env.example.
  return process.env.DATABASE_URL ?? `file:${bundledPath}`;
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ datasourceUrl: resolveDatabaseUrl() });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
