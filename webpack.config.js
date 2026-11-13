const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const pkg = require('./package.json');

// Build of the local poker bot extension (src/bot/ext). The earlier overlay
// extension still builds with webpack.legacy.config.js into dist-legacy/.
module.exports = {
  entry: {
    'content-script': './src/bot/ext/content.ts',
    background: './src/bot/ext/background.ts',
    popup: './src/bot/ext/popup.ts',
    dashboard: './src/bot/ext/dashboard.ts',
  },
  output: { path: path.resolve(__dirname, 'dist'), filename: '[name].js', clean: true },
  module: { rules: [{ test: /.ts$/, use: { loader: 'ts-loader', options: { transpileOnly: true } }, exclude: /node_modules/ }] },
  resolve: { extensions: ['.ts', '.js'] },
  plugins: [
    new CopyPlugin({
      patterns: [{
        from: 'manifest.json', to: 'manifest.json',
        transform: (content) => JSON.stringify({ ...JSON.parse(content.toString()), version: pkg.version }, null, 2),
      }],
    }),
    new HtmlWebpackPlugin({ template: './src/bot/ext/popup.html', filename: 'popup.html', chunks: ['popup'] }),
    new HtmlWebpackPlugin({ template: './src/bot/ext/dashboard.html', filename: 'dashboard.html', chunks: ['dashboard'] }),
  ],
  optimization: { minimize: false },
  // No eval-based source maps: Manifest V3 forbids eval in extension code.
  devtool: 'cheap-module-source-map',
  performance: { hints: false },
};
