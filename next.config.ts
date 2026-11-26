import type { NextConfig } from "next";

// On GitHub Pages the site lives under /<repo-name>; locally it lives at the root.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export", // fully static: every page is a client component talking to Firebase
  basePath,
  trailingSlash: true, // /stage/ → stage/index.html, served correctly by GitHub Pages
  images: { unoptimized: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
