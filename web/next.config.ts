import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // This app imports Convex's generated types from ../convex (monorepo,
  // single Convex deployment shared with the WhatsApp bot). The workspace
  // root has to stay at the repo root (not this directory) for that import
  // to resolve — Next's own root-inference already lands there because of
  // the top-level lockfile, this just makes it explicit instead of relying
  // on inference (and silences the "detected multiple lockfiles" warning).
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
