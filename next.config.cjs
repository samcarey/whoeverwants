/** @type {import('next').NextConfig} */
module.exports = {
  // Optimize for mobile performance and force webpack
  experimental: {
    optimizeCss: true,
    turbo: false, // Force webpack over turbopack
  },
  
  // Performance optimizations
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },

  // Inject build-time constants with fresh timestamp on each compilation
  webpack: (config, { webpack, dev, isServer }) => {
    // Generate a fresh timestamp for each webpack compilation
    const buildTimestamp = Date.now();
    
    config.plugins.push(
      new webpack.DefinePlugin({
        'process.env.BUILD_TIMESTAMP': JSON.stringify(buildTimestamp),
        'process.env.BUILD_TIME_ISO': JSON.stringify(new Date(buildTimestamp).toISOString()),
      })
    );

    // Write initial timestamp file immediately
    if (dev && !isServer) {
      const fs = require('fs');
      const path = require('path');
      
      const timestampFile = path.join(process.cwd(), 'lib', 'last-compile-time.ts');
      const timestamp = Date.now();
      const content = `// Auto-generated on every compilation
export const lastCompileTime = ${timestamp};
export const lastCompileISO = "${new Date(timestamp).toISOString()}";
`;
      try {
        fs.writeFileSync(timestampFile, content);
        console.log('✓ Build timestamp updated:', new Date(timestamp).toISOString());
      } catch (e) {
        console.log('Failed to write timestamp file:', e.message);
      }
    }

    return config;
  },

  // Headers for better caching and mobile performance
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
        ],
      },
      {
        source: '/_next/static/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
};