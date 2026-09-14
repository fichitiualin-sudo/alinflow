import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/send-work-report": ["./src/lib/alinflow/pdf-fonts/*"],
    "/api/h-tariff/pdf": ["./src/lib/alinflow/pdf-fonts/*", "./public/forms/h-tariff/*.pdf"],
  },
};

export default nextConfig;
