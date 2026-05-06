import { performance } from 'perf_hooks';
import { createClient } from '../client';

export interface DemoResult {
  trace: string[];
  totalRequests: number;
  blockedRequests: number;
  costBeforeFirewall: number;
  costAfterFirewall: number;
  totalCostSavedUsd: number;
  durationMs: number;
  loopDetected: boolean;
}

/**
 * This product is valuable only if users can SEE money saved instantly.
 */
export function runDemo(): DemoResult {
  const start = performance.now();
  const client = createClient({
    apiKey: 'demo_key',
    policy: { loopThreshold: 3, loopWindowMs: 12_000, strict: true, maxCostUsd: 0.3, throttleCostUsd: 0.15 },
  });

  const simulatedCosts = [0.12, 0.18, 0.31, 0.44, 0.52];
  const trace: string[] = [];
  let costBeforeFirewall = 0;
  let costAfterFirewall = 0;
  let blockedRequests = 0;
  let loopDetected = false;

  for (let i = 0; i < simulatedCosts.length; i++) {
    const callNumber = i + 1;
    const cost = simulatedCosts[i];
    costBeforeFirewall += cost;

    const result = client.evaluate({
      model: 'gpt-4o',
      prompt: 'agent-step-loop-prompt',
      maxOutputTokens: Math.max(1, Math.ceil(cost * 1000)),
      metadata: { sessionId: 'demo-loop', requestId: `demo-${callNumber}` },
    });

    if (result.decision === 'block') {
      blockedRequests++;
      loopDetected = loopDetected || result.ruleTriggered === 'loop-protection-v1';
      trace.push(`Agent Call #${callNumber} -> $${cost.toFixed(2)} (blocked: ${result.reason})`);
    } else {
      costAfterFirewall += cost;
      trace.push(`Agent Call #${callNumber} -> $${cost.toFixed(2)} (allowed)`);
    }
  }

  const totalCostSavedUsd = Number((costBeforeFirewall - costAfterFirewall).toFixed(6));
  const durationMs = Number((performance.now() - start).toFixed(2));
  return {
    trace,
    totalRequests: simulatedCosts.length,
    blockedRequests,
    costBeforeFirewall: Number(costBeforeFirewall.toFixed(6)),
    costAfterFirewall: Number(costAfterFirewall.toFixed(6)),
    totalCostSavedUsd,
    durationMs,
    loopDetected,
  };
}

export function formatDemoOutput(result: DemoResult): string {
  const lines: string[] = [];
  lines.push('AI FIREWALL DEMO TIMELINE');
  lines.push('========================');
  lines.push(...result.trace);
  lines.push('');
  lines.push('FIREWALL TRIGGERED:');
  lines.push(`- LOOP DETECTED: ${result.loopDetected ? 'YES' : 'NO'}`);
  lines.push(`- BLOCKED REQUESTS: ${result.blockedRequests}/${result.totalRequests}`);
  lines.push('');
  lines.push('ROI SNAPSHOT');
  lines.push('------------');
  lines.push(`COST BEFORE: $${result.costBeforeFirewall.toFixed(2)}`);
  lines.push(`COST AFTER:  $${result.costAfterFirewall.toFixed(2)}`);
  lines.push(`SAVED VALUE: $${result.totalCostSavedUsd.toFixed(2)}`);
  lines.push(`TIME SPENT:  ${(result.durationMs / 1000).toFixed(2)}s`);
  return lines.join('\n');
}
