import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4181,
    strictPort: true
  },
  build: {
    outDir: "dist-renderer",
    emptyOutDir: true,
    // 代码分割优化
    rollupOptions: {
      output: {
        // 手动分包策略
        manualChunks: {
          // React 核心库单独打包
          'react-vendor': ['react', 'react-dom'],
          // 图标库单独打包（通常较大）
          'icons': ['lucide-react'],
          // Excel 处理库单独打包
          'excel': ['exceljs'],
          // 工具库单独打包
          'utils': ['clsx']
        },
        // 优化文件命名
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]'
      }
    },
    // 构建性能优化
    target: 'esnext',
    minify: 'esbuild',
    // 启用 CSS 代码分割
    cssCodeSplit: true,
    // 设置合理的 chunk 大小警告阈值（Electron 应用可以适当放宽）
    chunkSizeWarningLimit: 1000,
    // 启用源码映射（生产环境可选）
    sourcemap: false,
    // 优化依赖预构建
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true
    }
  },
  // 优化依赖预构建
  optimizeDeps: {
    include: ['react', 'react-dom', 'lucide-react', 'clsx'],
    exclude: []
  },
  // 性能优化
  esbuild: {
    // 移除 console 和 debugger（生产环境）
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
    // 压缩标识符
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true
  }
});
