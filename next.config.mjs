/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pdfjs (under pdf-parse) does not survive webpack bundling — parsing a PDF
  // fails with "Object.defineProperty called on non-object". Loading it from
  // node_modules at runtime instead is the supported fix.
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse', 'pdfjs-dist'],
  },
  // Keep the test build in its own folder so it can never be served by mistake.
  distDir: process.env.CF_FAKE_DB === '1' ? '.next-test' : '.next',
  async headers() {
    return [
      {
        // Baseline for every page. Deliberately conservative: this app frames
        // nothing of its own, loads no third-party scripts, and the one route
        // that must be embeddable overrides frame-ancestors below.
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          // Two years, and only meaningful over HTTPS — browsers ignore it on
          // plain http, so this is safe in local development.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
      {
        // Clickjacking protection for everything *except* the embed view,
        // whose entire job is to be framed by other people's sites. Headers
        // from every matching rule are merged, so this cannot go in the
        // baseline above: browsers are supposed to ignore X-Frame-Options when
        // a CSP frame-ancestors is present, but not all of them do, and a
        // widget that silently refuses to render on a customer's site is a
        // failure nobody would connect back to a header.
        source: '/((?!embed/).*)',
        headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }],
      },
      {
        // The embed view and the widget loader must be reachable from any site.
        source: '/embed/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          // Explicitly allow framing. (Do NOT add X-Frame-Options here.)
          { key: 'Content-Security-Policy', value: 'frame-ancestors *' },
        ],
      },
      {
        source: '/widget.js',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=300' },
        ],
      },
    ];
  },
};

export default nextConfig;
