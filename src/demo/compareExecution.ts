import { ExecutionGuard } from '../firewall/executionGuard';

export interface CompareExecutionResult {
  costWithoutFirewall: number;
  costWithFirewall: number;
  loopsDetected: number;
  savingsDifference: number;
}

export async function compareExecution(
  beforeFn: () => Promise<number[]>,
  afterFn: () => Promise<number[]>
): Promise<CompareExecutionResult> {
  const before = await beforeFn();
  const after = await afterFn();
  const costWithoutFirewall = before.reduce((sum, n) => sum + n, 0);
  const costWithFirewall = after.reduce((sum, n) => sum + n, 0);
  const loopsDetected = Math.max(0, before.length - after.length);
  return {
    costWithoutFirewall: Number(costWithoutFirewall.toFixed(6)),
    costWithFirewall: Number(costWithFirewall.toFixed(6)),
    loopsDetected,
    savingsDifference: Number((costWithoutFirewall - costWithFirewall).toFixed(6)),
  };
}

export function compareWithGuard(costSeries: number[]): CompareExecutionResult {
  const guard = new ExecutionGuard({ loopThreshold: 3, loopWindowMs: 12_000, strict: true });
  const before = [...costSeries];
  const after: number[] = [];
  for (const cost of costSeries) {
    const result = guard.evaluate({
      model: 'gpt-4o-mini',
      prompt: 'looping-agent-step',
      maxOutputTokens: Math.max(1, Math.ceil(cost * 1000)),
      metadata: { sessionId: 'compare-session' },
    });
    if (result.decision !== 'block') {
      after.push(cost);
    }
  }
  const costWithoutFirewall = before.reduce((sum, n) => sum + n, 0);
  const costWithFirewall = after.reduce((sum, n) => sum + n, 0);
  return {
    costWithoutFirewall: Number(costWithoutFirewall.toFixed(6)),
    costWithFirewall: Number(costWithFirewall.toFixed(6)),
    loopsDetected: before.length - after.length,
    savingsDifference: Number((costWithoutFirewall - costWithFirewall).toFixed(6)),
  };
}
