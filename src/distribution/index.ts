/**
 * Distribution Engine - Self-serve viral distribution loop
 * 
 * Exports:
 * - DemoLinkGenerator: Shareable demo session links
 * - HostedDemoServer: HTTP server with demo routes
 * - PublicDemoPage: HTML/JSON output for demos
 * - ViralPayloadFormatter: Tweet/markdown share cards
 */

export {
  DemoLinkGenerator,
  DemoSession,
  DemoScenario,
  DemoStep,
  DemoSummary,
  ShareableLink,
  DEMO_SCENARIOS,
  HERO_SCENARIO,
  demoLinkGenerator,
  createDemoSession,
  getShareableLink,
  quickDemo,
} from './demoLinkGenerator';

export {
  HostedDemoServer,
  DemoServerConfig,
  hostedDemoServer,
  startDemoServer,
  stopDemoServer,
  getDemoServerUrl,
} from './hostedDemoServer';

export {
  generateDemoHTML,
  generateDemoJSON,
  DemoPageOptions,
  DemoJSON,
  formatCurrency,
  escapeHtml,
} from './publicDemoPage';

export {
  generateViralPayload,
  ViralPayload,
  ShareCard,
  generateTweet,
  generateLinkedIn,
  generateMarkdown,
  generateHTML,
  generateCopyBlock,
  generateSocialCardMeta,
  generateEmailContent,
} from './viralPayloadFormatter';
