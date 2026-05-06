/**
 * CostExplosionDemo.ts - SINGLE HERO USE CASE ONLY
 * 
 * One scenario: "Runaway Agent Cost Explosion"
 * 
 * Simulates: AI agent stuck in infinite confirmation loop
 * Result: Shows cost saved by blocking redundant calls
 * 
 * NO OTHER SCENARIOS. This is the ONLY demo.
 */

import * as crypto from 'crypto';
import { ExecutionTrace } from '../trust';

export interface DemoResult {
  demoId: string;
  userId: string;
  timestamp: number;
  
  // Financial impact (sales-ready output)
  costBefore: number;
  costAfter: number;
  saved: number;
  percentSaved: number;
  
  // Execution stats
  totalCalls: number;
  blocked: number;
  allowed: number;
  
  // Sales insight
  insight: string;
  
  // Audit trace
  executionTrace: ExecutionTrace;
}

// HERO CONFIGURATION - The only scenario we support
const HERO_CONFIG = {
  name: 'Runaway Agent Loop Cost Explosion',
  description: 'AI agent gets stuck in infinite confirmation loop',
  totalCalls: 50,
  costPerCall: 0.03, // GPT-4 cost
  detectionThreshold: 3, // Detect loop after 3 similar calls
  model: 'gpt-4',
} as const;

/**
 * runCostExplosionDemo - The ONE and ONLY demo
 * 
 * Simulates 50 API calls where an agent gets stuck in a loop.
 * First 3 calls are normal, then loop is detected and blocked.
 * Shows $1.41 saved (94% cost reduction).
 */
export function runCostExplosionDemo(userId: string): DemoResult {
  const demoId = crypto.randomBytes(8).toString('hex');
  const timestamp = Date.now();
  
  const traceSteps: ExecutionTrace['steps'] = [];
  
  let costBefore = 0;
  let costAfter = 0;
  let blocked = 0;
  let allowed = 0;
  
  // Simulate exactly 50 calls
  for (let i = 1; i <= HERO_CONFIG.totalCalls; i++) {
    const callCost = HERO_CONFIG.costPerCall;
    costBefore += callCost;
    
    // Decision logic: Allow first 3, then block
    let decision: 'allow' | 'block';
    let reason: string;
    
    if (i <= HERO_CONFIG.detectionThreshold) {
      decision = 'allow';
      allowed++;
      costAfter += callCost;
      
      if (i === 1) reason = 'Initial request - normal';
      else if (i === 2) reason = 'Second request - monitoring';
      else reason = 'Third request - pattern building';
    } else {
      decision = 'block';
      blocked++;
      reason = i === 4 
        ? '🔥 LOOP DETECTED: Same confirmation pattern'
        : `Blocked redundant call #${i - 3}`;
    }
    
    traceSteps.push({
      step: i,
      name: `api_call_${i}`,
      input: { callNumber: i, estimatedCost: callCost },
      output: { decision, reason, blocked: decision === 'block' },
      timestamp: timestamp + i,
    });
  }
  
  const saved = costBefore - costAfter;
  const percentSaved = (saved / costBefore) * 100;
  
  const executionTrace: ExecutionTrace = {
    steps: traceSteps,
    finalCalculation: {
      inputs: {
        totalCalls: HERO_CONFIG.totalCalls,
        costPerCall: HERO_CONFIG.costPerCall,
        detectionThreshold: HERO_CONFIG.detectionThreshold,
      },
      formula: '(blocked * costPerCall) = moneySaved',
      result: saved,
    },
  };
  
  return {
    demoId,
    userId,
    timestamp,
    costBefore,
    costAfter,
    saved,
    percentSaved,
    totalCalls: HERO_CONFIG.totalCalls,
    blocked,
    allowed,
    insight: `We blocked ${blocked} runaway calls before they cost you money`,
    executionTrace,
  };
}

/**
 * Get hero scenario metadata for display
 */
export function getHeroScenario() {
  return {
    ...HERO_CONFIG,
    estimatedSavings: '$1.41',
    savingsPercent: '94%',
    timeToDetect: '< 1 second',
  };
}

/**
 * Generate tweet-ready share text
 */
export function generateShareText(result: DemoResult): string {
  return `🛡️ Just stopped a cost explosion!

${result.insight}

Cost without protection: $${result.costBefore.toFixed(2)}
Cost with firewall: $${result.costAfter.toFixed(2)}

💰 SAVED: $${result.saved.toFixed(2)} (${result.percentSaved.toFixed(0)}%)

Stop AI agents from wasting money → https://ai-costguard.com`;
}

/**
 * Generate sales-ready embed HTML
 */
export function generateROIEmbed(result: DemoResult): string {
  return `
<div style="font-family: sans-serif; max-width: 400px; border: 2px solid #667eea; border-radius: 12px; padding: 24px;">
  <h3 style="margin: 0 0 16px; color: #667eea;">💰 Cost Explosion Blocked</h3>
  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
    <div style="text-align: center; background: #fee; padding: 12px; border-radius: 8px;">
      <div style="font-size: 1.5rem; font-weight: bold; color: #dc2626;">$${result.costBefore.toFixed(2)}</div>
      <div style="font-size: 0.75rem; color: #666;">Without Protection</div>
    </div>
    <div style="text-align: center; background: #efe; padding: 12px; border-radius: 8px;">
      <div style="font-size: 1.5rem; font-weight: bold; color: #16a34a;">$${result.costAfter.toFixed(2)}</div>
      <div style="font-size: 0.75rem; color: #666;">With Firewall</div>
    </div>
  </div>
  <div style="text-align: center; background: #667eea; color: white; padding: 16px; border-radius: 8px;">
    <div style="font-size: 1.25rem; font-weight: bold;">$${result.saved.toFixed(2)} Saved</div>
    <div style="font-size: 0.875rem; opacity: 0.9;">${result.percentSaved.toFixed(0)}% reduction • ${result.blocked} blocked calls</div>
  </div>
  <p style="margin: 16px 0 0; color: #166534; font-weight: 500; text-align: center;">
    ${result.insight}
  </p>
</div>
  `.trim();
}
