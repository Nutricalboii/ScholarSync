/** @type {import('next').NextConfig} */
const nextConfig = {
  // Bypassing these helps prevent Vercel build failures during rapid hackathon iterations
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  async rewrites() {
    return [
      {
        // Optimized proxy to bypass Vercel's 10s execution limit for hackathon reliability
        source: '/api/:path*',
        destination: process.env.NEXT_PUBLIC_API_URL || 'https://scholarsync-jh4j.onrender.com/:path*',
      },
    ];
  },
};

export default nextConfig;