const webpack = require('webpack');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // wagmi's connectors barrel pulls in optional peer deps that aren't
    // published (@x402/*, @react-native-async-storage/async-storage,
    // pino-pretty). They are only used by code paths this app never calls
    // (x402 payments, RN storage, pretty logging), so stub them out.
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /^@x402\/|^@react-native-async-storage\/async-storage$|^pino-pretty$/,
      })
    );
    return config;
  },
};

module.exports = nextConfig;
