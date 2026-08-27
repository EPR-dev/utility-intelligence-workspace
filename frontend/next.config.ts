import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Production (Vercel) serves map layers from /public/data and API routes in this app.
  // Local FastAPI on :8000 is optional; set NEXT_PUBLIC_API_URL if you still want it.
};

export default nextConfig;
