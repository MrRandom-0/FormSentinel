import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: [
    "@formsentinel/config",
    "@formsentinel/database",
    "@formsentinel/forms",
    "@formsentinel/form-schema",
    "@formsentinel/test-console",
    "@formsentinel/ui",
  ],
  serverExternalPackages: ["@formsentinel/security", "@formsentinel/auth"],
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
};
export default config;
