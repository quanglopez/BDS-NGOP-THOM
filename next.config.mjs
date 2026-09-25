/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Chống cảnh báo "multiple lockfiles" khi máy có lockfile ở thư mục cha
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
