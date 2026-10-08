import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // postgres.js and bcryptjs must stay outside the server bundle
  serverExternalPackages: ["postgres", "bcryptjs", "pptxgenjs"],
};

export default config;
