/**
 * Gravity Layer - Dependency Gravity & Auto-Protection
 * 
 * One abstraction: autoProtect()
 * 
 * Automatically protects:
 * - OpenAI client
 * - Global fetch
 * - Axios
 * - Express middleware
 * - Serverless handlers
 * 
 * Goal: Install once, protect everything. System sits in execution path.
 */

export {
  autoProtect,
  middleware,
  serverless,
  productionDefault,
  wrapGlobalFetch,
  getProtectionStats,
  AutoProtectConfig,
  ProtectedClient,
} from './AutoProtect';
