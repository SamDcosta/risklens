import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The homepage reads three files at request time by absolute path
  // (prisma/dev.db, data/betas.json, eval/results.json). Next's tracer can't
  // see through readFileSync/Prisma to find them, so they'd be missing from
  // the serverless bundle and the page would silently render empty.
  outputFileTracingIncludes: {
    "/": ["./prisma/dev.db", "./data/betas.json", "./eval/results.json"],
  },
};

export default nextConfig;
