import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  trailingSlash: true,
  images: {
    unoptimized: true,
  },

  // Expose Vercel's git branch to the client for preview API URL derivation
  env: {
    NEXT_PUBLIC_VERCEL_GIT_BRANCH: process.env.VERCEL_GIT_COMMIT_REF || '',
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
};

if (process.env.NEXT_OUTPUT === 'standalone') {
  // Docker production build: standalone output for minimal image size
  nextConfig.output = 'standalone';
} else {
  // In development, proxy /api/polls requests to the local Python API server
  nextConfig.rewrites = async () => ({
    beforeFiles: [
      // API rewrites must be in beforeFiles so they take priority over
      // the trailingSlash redirect (which otherwise 308s API POST requests)
      {
        source: '/api/polls',
        destination: `${process.env.PYTHON_API_URL || 'http://localhost:8000'}/api/polls`,
      },
      {
        source: '/api/polls/',
        destination: `${process.env.PYTHON_API_URL || 'http://localhost:8000'}/api/polls`,
      },
      {
        source: '/api/polls/:path*',
        destination: `${process.env.PYTHON_API_URL || 'http://localhost:8000'}/api/polls/:path*`,
      },
    ],
    afterFiles: [],
    fallback: [],
  });

  // Headers for tunnel compatibility and environment-specific caching
  // (not supported with static export)
  nextConfig.headers = async () => {
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
  };
}

export default nextConfig;
