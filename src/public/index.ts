/**
 * Public Layer - Trust & Transparency Pages
 * 
 * External-facing pages for public verification:
 * - /status - System status and uptime
 * - /benchmarks - Reproducible performance tests
 * - /docs - Technical API reference
 */

export {
  generateStatusPage,
  getCurrentStatus,
  SystemStatus,
} from './StatusPage';

export {
  generateBenchmarksPage,
  BENCHMARK_SCENARIOS,
  BenchmarkResult,
  BenchmarkSuite,
} from './BenchmarksPage';

export {
  generateDocsPage,
} from './DocsPage';
