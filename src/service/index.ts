/**
 * Service Layer - SaaS Backend
 * 
 * Production-hosted service with:
 * - User accounts & authentication
 * - API key management
 * - Instant demo with ROI
 */

export {
  SaaSServer,
  SaaSConfig,
  saasServer,
  startSaaS,
} from './SaaSServer';

export {
  UserStore,
  User,
  ApiKey,
  Session,
  userStore,
} from './UserStore';

export {
  runHeroDemo,
  DemoResult,
  getHeroScenario,
  generateInstantROIMessage,
  generateShareText,
} from './HeroDemo';
