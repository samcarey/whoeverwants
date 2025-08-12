/** @type {import('next').NextConfig} */
export default {
  // Optimize for mobile performance
  experimental: {
    optimizeCss: true,
  },
  
  // Performance optimizations
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },

  // Inject build-time constants
  webpack: (config, { webpack }) => {
    config.plugins.push(
      new webpack.DefinePlugin({
        'process.env.BUILD_TIMESTAMP': JSON.stringify(Date.now()),
        'process.env.BUILD_TIME_ISO': JSON.stringify(new Date().toISOString()),
      })
    );
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