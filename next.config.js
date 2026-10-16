/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  transpilePackages: ['three'],
  // Fully static site: `next build` writes plain HTML/JS/assets to out/ (deployed to Netlify).
  output: 'export',
  trailingSlash: true,
};

module.exports = nextConfig;
