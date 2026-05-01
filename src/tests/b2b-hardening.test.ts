import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DetectionEngine } from '../core/DetectionEngine';
import { ConfigManager, estimateCost, getModelPricing, registerPricingModel } from '../config';

describe('B2B production hardening', () => {
  let engine: DetectionEngine;
  let config: ConfigManager;
  let originalConfig: ReturnType<ConfigManager['getConfig']>;

  beforeEach(() => {
    engine = DetectionEngine.getInstance();
    config = new ConfigManager();
    originalConfig = config.getConfig();
    engine.clear();
  });

  afterEach(() => {
    config.updateConfig(originalConfig);
    engine.reset();
  });

  test('stores hash-only prompt history by default', () => {
    config.updateConfig({
      privacy: {
        ...originalConfig.privacy,
        promptStorage: 'hash',
      },
    });
    engine.reset();
    const secretPrompt = 'customer email test@example.com with api key sk-testsecret1234567890';

    engine.analyze({
      model: 'gpt-4',
      prompt: secretPrompt,
      estimatedCost: 0.001,
    });

    const historyPath = path.join(os.homedir(), '.aifw', 'history.jsonl');
    const persisted = fs.readFileSync(historyPath, 'utf-8');

    expect(persisted).not.toContain(secretPrompt);
    expect(persisted).not.toContain('test@example.com');
    expect(persisted).toContain('[hash:');
  });

  test('applies scoped daily budgets from request metadata', () => {
    config.updateConfig({
      trustMode: 'block',
      budgets: {
        ...originalConfig.budgets,
        perRequestUsd: 1,
        dailyUsd: 50,
        monthlyUsd: 1000,
      },
      policies: [
        {
          id: 'tenant-low-budget',
          scope: { orgId: 'org-low' },
          budgets: { dailyUsd: 0.015 },
        },
      ],
    });
    engine.reset();

    const first = engine.analyze({
      model: 'gpt-4',
      prompt: 'first tenant budget request',
      estimatedCost: 0.01,
      metadata: { orgId: 'org-low', userId: 'user-1' },
    });
    expect(first.decision).toBe('allow');

    const second = engine.analyze({
      model: 'gpt-4',
      prompt: 'second unrelated tenant request',
      estimatedCost: 0.01,
      metadata: { orgId: 'org-low', userId: 'user-1' },
    });

    expect(second.decision).toBe('block');
    expect(second.category).toBe('budget');
    expect(second.metadata.policyId).toBe('tenant-low-budget');
  });

  test('scoped budgets block before cost-spike warnings in warn mode', () => {
    config.updateConfig({
      trustMode: 'warn',
      policies: [
        {
          id: 'tenant-hard-cap',
          scope: { orgId: 'org-hard-cap' },
          budgets: {
            perRequestUsd: 0.05,
            dailyUsd: 1,
            monthlyUsd: 10,
          },
        },
      ],
    });
    engine.reset();

    const result = engine.analyze({
      model: 'gpt-4',
      prompt: 'request over tenant cap',
      estimatedCost: 0.1,
      trustMode: 'warn',
      metadata: { orgId: 'org-hard-cap' },
    });

    expect(result.decision).toBe('block');
    expect(result.category).toBe('budget');
    expect(result.metadata.policyId).toBe('tenant-hard-cap');
  });

  test('registers custom pricing models and aliases', () => {
    registerPricingModel('acme-agent-model', {
      provider: 'custom',
      inputPrice: 0.002,
      outputPrice: 0.004,
      cachedInputPrice: 0.001,
      aliases: ['openrouter/acme-agent-model'],
    });

    const pricing = getModelPricing('openrouter/acme-agent-model');
    const cost = estimateCost('openrouter/acme-agent-model', 1000, 1000, {
      cachedInputTokens: 500,
    });

    expect(pricing?.model).toBe('acme-agent-model');
    expect(cost).toBeCloseTo(0.0055);
  });

  test('returns budget status for metadata scopes', () => {
    engine.analyze({
      model: 'gpt-4',
      prompt: 'budget status request',
      estimatedCost: 0.01,
      metadata: { orgId: 'org-status', workflowId: 'wf-1' },
    });

    const status = engine.getBudgetStatus({ orgId: 'org-status', workflowId: 'wf-1' });

    expect(status.dailySpend).toBeCloseTo(0.01);
    expect(status.workflowSpend).toBeCloseTo(0.01);
  });
});
