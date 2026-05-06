/**
 * demoLinkGenerator.ts - Shareable Demo Session Links
 * 
 * Creates self-contained demo sessions that can be shared via URL.
 * Each demo session stores:
 * - Simulated agent run
 * - ROI results
 * - Replayable execution
 * 
 * Enables viral distribution - users can share their demo results.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface DemoSession {
  id: string;
  createdAt: number;
  expiresAt: number;
  
  // Simulation configuration
  scenario: DemoScenario;
  
  // Execution results
  steps: DemoStep[];
  summary: DemoSummary;
  
  // Metadata for sharing
  title: string;
  description: string;
  tags: string[];
}

export interface DemoScenario {
  name: string;
  description: string;
  agentType: 'chatbot' | 'code' | 'research' | 'automation';
  model: string;
  requestCount: number;
  avgRequestCost: number;
  loopProbability: number; // 0-1
  duplicateProbability: number; // 0-1
}

export interface DemoStep {
  stepNumber: number;
  request: string;
  model: string;
  estimatedCost: number;
  decision: 'allow' | 'block' | 'throttle';
  decisionReason: string;
  timestamp: number;
  saved: number;
}

export interface DemoSummary {
  totalRequests: number;
  allowed: number;
  blocked: number;
  throttled: number;
  totalCostBefore: number;
  totalCostAfter: number;
  totalSaved: number;
  savingsPercent: number;
  avgResponseTime: number;
}

export interface ShareableLink {
  url: string;
  shortCode: string;
  expiresAt: number;
  previewImage?: string;
}

// SINGLE HERO SCENARIO: Runaway Agent Loop Cost Explosion
// Focus ONLY on preventing AI agent cost explosions in production
export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    name: 'Runaway Agent Loop',
    description: 'AI agent gets stuck in infinite confirmation loop, burning API budget',
    agentType: 'chatbot',
    model: 'gpt-4',
    requestCount: 50,
    avgRequestCost: 0.03,
    loopProbability: 0.9,
    duplicateProbability: 0.8,
  },
];

// HERO SCENARIO ONLY - for single use case focus
export const HERO_SCENARIO = DEMO_SCENARIOS[0];

/**
 * DemoLinkGenerator - Creates shareable demo sessions
 * 
 * Viral distribution mechanism:
 * 1. User runs a demo scenario
 * 2. Results are saved with unique ID
 * 3. User shares link: /demo/:id
 * 4. Anyone can view the replay without installing
 */
export class DemoLinkGenerator {
  private storagePath: string;
  private sessions: Map<string, DemoSession> = new Map();
  private readonly SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  constructor(customPath?: string) {
    this.storagePath = customPath || path.join(os.homedir(), '.ai-firewall', 'demos');
    this.ensureDirectoryExists();
    this.loadExistingSessions();
  }

  /**
   * Create a new demo session from a scenario
   */
  createDemoSession(
    scenario: DemoScenario | string,
    options?: {
      title?: string;
      description?: string;
      tags?: string[];
    }
  ): DemoSession {
    const scenarioObj = typeof scenario === 'string' 
      ? DEMO_SCENARIOS.find(s => s.name === scenario) || DEMO_SCENARIOS[0]
      : scenario;

    const id = this.generateShortId();
    const now = Date.now();

    // Simulate execution
    const steps = this.simulateSteps(scenarioObj);
    const summary = this.calculateSummary(steps);

    const session: DemoSession = {
      id,
      createdAt: now,
      expiresAt: now + this.SESSION_TTL_MS,
      scenario: scenarioObj,
      steps,
      summary,
      title: options?.title || `${scenarioObj.name} Demo`,
      description: options?.description || scenarioObj.description,
      tags: options?.tags || ['demo', scenarioObj.agentType],
    };

    this.sessions.set(id, session);
    this.persistSession(session);

    return session;
  }

  /**
   * Get a shareable link for a session
   */
  getShareableLink(sessionId: string, baseUrl?: string): ShareableLink | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    const base = baseUrl || 'https://ai-firewall.io';
    
    return {
      url: `${base}/demo/${sessionId}`,
      shortCode: sessionId,
      expiresAt: session.expiresAt,
      previewImage: `${base}/demo/${sessionId}/preview.png`,
    };
  }

  /**
   * Get a session by ID
   */
  getSession(id: string): DemoSession | null {
    return this.sessions.get(id) || null;
  }

  /**
   * List all active sessions
   */
  listSessions(): Array<{
    id: string;
    title: string;
    createdAt: number;
    expiresAt: number;
    summary: DemoSummary;
  }> {
    const now = Date.now();
    return Array.from(this.sessions.values())
      .filter(s => s.expiresAt > now)
      .map(s => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        summary: s.summary,
      }));
  }

  /**
   * Delete a session
   */
  deleteSession(id: string): boolean {
    const deleted = this.sessions.delete(id);
    if (deleted) {
      this.deleteSessionFile(id);
    }
    return deleted;
  }

  /**
   * Generate a quick demo with default settings
   */
  quickDemo(scenarioName?: string): {
    session: DemoSession;
    link: ShareableLink;
  } {
    const scenario = DEMO_SCENARIOS.find(s => s.name === scenarioName) || DEMO_SCENARIOS[0];
    const session = this.createDemoSession(scenario);
    const link = this.getShareableLink(session.id)!;

    return { session, link };
  }

  // Private methods

  private simulateSteps(scenario: DemoScenario): DemoStep[] {
    const steps: DemoStep[] = [];
    let timestamp = Date.now();

    for (let i = 0; i < scenario.requestCount; i++) {
      // Determine if this step should be blocked/duplicate
      const isLoop = i > 2 && Math.random() < scenario.loopProbability;
      const isDuplicate = i > 0 && Math.random() < scenario.duplicateProbability;

      let decision: DemoStep['decision'] = 'allow';
      let decisionReason = 'Normal request';
      let saved = 0;

      if (isLoop) {
        decision = 'block';
        decisionReason = 'Loop detected - repetitive request pattern';
        saved = scenario.avgRequestCost * 5; // Save multiple future calls
      } else if (isDuplicate) {
        decision = 'throttle';
        decisionReason = 'Duplicate request - similar to recent call';
        saved = scenario.avgRequestCost * 0.5;
      }

      steps.push({
        stepNumber: i + 1,
        request: this.generateRequestText(scenario, i, isLoop, isDuplicate),
        model: scenario.model,
        estimatedCost: scenario.avgRequestCost,
        decision,
        decisionReason,
        timestamp: timestamp + i * 1000,
        saved,
      });
    }

    return steps;
  }

  private generateRequestText(
    scenario: DemoScenario,
    index: number,
    isLoop: boolean,
    isDuplicate: boolean
  ): string {
    if (isLoop) {
      return `Loop iteration ${index} - repeated confirmation request`;
    }
    if (isDuplicate) {
      return `Similar to request ${index - 1} - ${scenario.agentType} query`;
    }
    return `${scenario.agentType} request ${index + 1}: Processing task`;
  }

  private calculateSummary(steps: DemoStep[]): DemoSummary {
    const totalRequests = steps.length;
    const allowed = steps.filter(s => s.decision === 'allow').length;
    const blocked = steps.filter(s => s.decision === 'block').length;
    const throttled = steps.filter(s => s.decision === 'throttle').length;

    const totalCostBefore = steps.reduce((sum, s) => sum + s.estimatedCost, 0);
    const totalSaved = steps.reduce((sum, s) => sum + s.saved, 0);
    const totalCostAfter = totalCostBefore - totalSaved;
    const savingsPercent = (totalSaved / totalCostBefore) * 100;

    return {
      totalRequests,
      allowed,
      blocked,
      throttled,
      totalCostBefore,
      totalCostAfter,
      totalSaved,
      savingsPercent,
      avgResponseTime: 45, // Simulated
    };
  }

  private generateShortId(): string {
    return crypto.randomBytes  (6).toString('base64url').substring(0, 8);
  }

  private ensureDirectoryExists(): void {
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
  }

  private persistSession(session: DemoSession): void {
    const filePath = path.join(this.storagePath, `${session.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf8');
  }

  private loadExistingSessions(): void {
    if (!fs.existsSync(this.storagePath)) {
      return;
    }

    const files = fs.readdirSync(this.storagePath);
    const now = Date.now();

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const filePath = path.join(this.storagePath, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const session: DemoSession = JSON.parse(content);

        // Only load non-expired sessions
        if (session.expiresAt > now) {
          this.sessions.set(session.id, session);
        } else {
          // Clean up expired session
          fs.unlinkSync(filePath);
        }
      } catch (e) {
        // Skip corrupted files
      }
    }
  }

  private deleteSessionFile(id: string): void {
    const filePath = path.join(this.storagePath, `${id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

// Singleton instance
export const demoLinkGenerator = new DemoLinkGenerator();

// Convenience exports
export function createDemoSession(
  scenario: DemoScenario | string,
  options?: Parameters<typeof demoLinkGenerator.createDemoSession>[1]
): DemoSession {
  return demoLinkGenerator.createDemoSession(scenario, options);
}

export function getShareableLink(sessionId: string, baseUrl?: string): ShareableLink | null {
  return demoLinkGenerator.getShareableLink(sessionId, baseUrl);
}

export function quickDemo(scenarioName?: string): {
  session: DemoSession;
  link: ShareableLink;
} {
  return demoLinkGenerator.quickDemo(scenarioName);
}

// DEMO_SCENARIOS already exported above
