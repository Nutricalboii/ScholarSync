/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'https://scholarsync-jh4j.onrender.com/:path*',
      },
    ];
  },
};

export default nextConfig;
