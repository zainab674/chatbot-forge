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
    // Next inlines its hydration bootstrap and next/font injects a <style>, so
    // 'unsafe-inline' is the price of not running a nonce middleware. That
    // makes this no defence against injected inline script — the escaping in
    // components/Markdown.tsx is what does that job — but the rest still earns
    // its place: nothing external can be loaded or connected to, so an
    // injection has nowhere to send what it finds, and object/base/form-action
    // close the usual redirect and data-exfiltration tricks.
    //
    // 'unsafe-eval' is development only; the dev server's HMR needs it.
    const script = ["'self'", "'unsafe-inline'", process.env.NODE_ENV === 'production' ? '' : "'unsafe-eval'"]
      .filter(Boolean)
      .join(' ');
    const policy = [
      "default-src 'self'",
      `script-src ${script}`,
      "style-src 'self' 'unsafe-inline'",
      // next/font/google self-hosts at build time, so no external font origin.
      "font-src 'self' data:",
      "img-src 'self' data: blob:",
      "media-src 'self' data: blob:",
      // three.js and react-three-fiber build workers from blobs.
      "worker-src 'self' blob:",
      // The builder previews a bot by framing its own /embed route.
      "frame-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');

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
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          // Not in the baseline above: headers from every matching rule are
          // merged, and two Content-Security-Policy headers are enforced as the
          // intersection of both — so a baseline carrying frame-ancestors would
          // override the embed's permissive one no matter what it said.
          { key: 'Content-Security-Policy', value: `${policy}; frame-ancestors 'self'` },
        ],
      },
      {
        // The embed view and the widget loader must be reachable from any site.
        source: '/embed/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          // Same policy, except that framing is the entire job here.
          // (Do NOT add X-Frame-Options to this route.)
          { key: 'Content-Security-Policy', value: `${policy}; frame-ancestors *` },
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
