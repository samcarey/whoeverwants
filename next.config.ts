import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Removed 'output: export' to support dynamic routes
  // Static export doesn't work with dynamic poll IDs
  trailingSlash: true,
  images: {
    unoptimized: true,
  },

  // Disable all caching in development mode
  webpack: (config, { dev, webpack }) => {
    if (dev) {
      // Disable webpack caching completely in development
      config.cache = false;
      
      // Force webpack to rebuild everything
      config.optimization = {
        ...config.optimization,
        removeAvailableModules: false,
        removeEmptyChunks: false,
        splitChunks: false,
      };
      
      
      // Inject timestamp via DefinePlugin
      const timestamp = Date.now().toString();
      config.plugins.push(
        new webpack.DefinePlugin({
          'process.env.BUILD_TIMESTAMP': JSON.stringify(timestamp)
        })
      );
    }
    return config;
  },

  // Headers for tunnel compatibility and environment-specific caching
  async headers() {
    const isDev = process.env.NODE_ENV === 'development';
    
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Forwarded-Proto',
            value: 'https'
          },
          {
            key: 'Access-Control-Allow-Origin',
            value: '*'
          },
          // Cache control for pages
          {
            key: 'Cache-Control',
            value: isDev 
              ? 'no-cache, no-store, must-revalidate, max-age=0'
              : 'public, max-age=3600, stale-while-revalidate=3600'
          },
        ],
      },
      {
        source: '/_next/static/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: isDev
              ? 'no-cache, no-store, must-revalidate, max-age=0'
              : 'public, max-age=31536000, immutable',
          },
          {
            key: 'Access-Control-Allow-Origin',
            value: '*'
          },
        ],
      },
      // API routes caching
      {
        source: '/api/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: isDev
              ? 'no-cache, no-store, must-revalidate, max-age=0'
              : 'public, max-age=3600, stale-while-revalidate=3600'
          },
        ],
      },
    ];
  },
};

export default nextConfig;
