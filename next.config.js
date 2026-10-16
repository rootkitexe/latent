/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  transpilePackages: ['three'],
  // Fully static site: `next build` writes plain HTML/JS/assets to out/ (deployed to Netlify).
  // (production only: Next 14's dev server mishandles generateStaticParams under 'export')
  ...(process.env.NODE_ENV === 'production' ? { output: 'export', trailingSlash: true } : {}),
};

module.exports = nextConfig;
