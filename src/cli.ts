#!/usr/bin/env node

import { getPricing } from './pricing/index.js';
import {
  formatDashboardSummary,
  getDefaultEventLogPath,
  startDashboardServer,
  summarizeDashboard,
  type DashboardOptions,
} from './dashboard.js';

/**
 * IO streams used by the CLI runner.
 */
export interface CliIO {
  /** Writes standard output. */
  stdout(message: string): void;
  /** Writes standard error. */
  stderr(message: string): void;
}

/**
 * Parsed options for the aifw check command.
 */
export interface CliCheckOptions {
  /** Budget in USD. */
  budget: number;
  /** Model name used for pricing. */
  model: string;
  /** Estimated output tokens per step. */
  tokens: number;
  /** Estimated input tokens per step. Defaults to 0. */
  inputTokens: number;
  /** Maximum number of steps to budget for. */
  maxSteps: number;
  /** Custom input price in USD per 1,000 tokens. */
  inputPricePer1k?: number;
  /** Custom output price in USD per 1,000 tokens. */
  outputPricePer1k?: number;
}

/**
 * Parsed options for the local dashboard command.
 */
export interface CliDashboardOptions extends DashboardOptions {
  once: boolean;
  json: boolean;
}

/**
 * Parses arguments for `aifw check`.
 */
export function parseCheckArgs(args: readonly string[]): CliCheckOptions {
  const options = new Map<string, string>();

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--')) continue;

    const key = arg.slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }

    options.set(key, value);
    index += 1;
  }

  return {
    budget: readRequiredNumber(options, 'budget'),
    model: readRequiredString(options, 'model'),
    tokens: readRequiredNumber(options, 'tokens'),
    inputTokens: readOptionalNumber(options, 'input-tokens') ?? 0,
    maxSteps: Math.max(1, Math.trunc(readOptionalNumber(options, 'max-steps') ?? 1)),
    inputPricePer1k: readOptionalNumber(options, 'input-price-per-1k'),
    outputPricePer1k: readOptionalNumber(options, 'output-price-per-1k'),
  };
}

/**
 * Parses arguments for `aifw dashboard`.
 */
export function parseDashboardArgs(args: readonly string[]): CliDashboardOptions {
  const options = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--')) continue;

    const key = arg.slice(2);
    if (key === 'once' || key === 'json') {
      flags.add(key);
      continue;
    }

    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }

    options.set(key, value);
    index += 1;
  }

  return {
    eventLogPath: readOptionalString(options, 'events') ?? getDefaultEventLogPath(),
    budgetUsd: readOptionalNumber(options, 'budget'),
    host: readOptionalString(options, 'host'),
    port: readOptionalNumber(options, 'port'),
    recentLimit: readOptionalNumber(options, 'recent'),
    once: flags.has('once'),
    json: flags.has('json'),
  };
}

/**
 * Runs the aifw CLI and returns a process exit code.
 */
export function runCli(args: readonly string[] = process.argv.slice(2), io: CliIO = defaultIO): number {
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    io.stdout(helpText());
    return 0;
  }

  if (command !== 'check' && command !== 'dashboard') {
    io.stderr(`Unknown command: ${command}\n\n${helpText()}`);
    return 2;
  }

  try {
    if (command === 'dashboard') {
      const options = parseDashboardArgs(args.slice(1));
      if (options.once || options.json) {
        const summary = summarizeDashboard(options);
        io.stdout(options.json ? JSON.stringify(summary, null, 2) + '\n' : formatDashboardSummary(summary));
        return 0;
      }

      void startDashboardServer(options)
        .then(({ url }) => {
          io.stdout(`AI CostGuard dashboard running at ${url}\nReading events from ${options.eventLogPath}\n`);
        })
        .catch((error: unknown) => {
          io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
          process.exitCode = 2;
        });
      return 0;
    }

    const options = parseCheckArgs(args.slice(1));
    const pricing = getPricing(options.model);
    const hasCustomPricing = options.inputPricePer1k !== undefined || options.outputPricePer1k !== undefined;

    if (hasCustomPricing && (options.inputPricePer1k === undefined || options.outputPricePer1k === undefined)) {
      io.stderr('--input-price-per-1k and --output-price-per-1k must be provided together.\n');
      return 2;
    }

    if (!pricing && !hasCustomPricing) {
      io.stderr(
        `No pricing found for model "${options.model}". Use a known model or pass --input-price-per-1k and --output-price-per-1k.\n`
      );
      return 2;
    }

    const inputPer1kTokens = options.inputPricePer1k ?? pricing?.inputPer1kTokens ?? 0;
    const outputPer1kTokens = options.outputPricePer1k ?? pricing?.outputPer1kTokens ?? 0;
    const perStepCost = (options.inputTokens / 1000) * inputPer1kTokens + (options.tokens / 1000) * outputPer1kTokens;
    const projectedCost = perStepCost * options.maxSteps;
    const ok = projectedCost <= options.budget;

    io.stdout(
      JSON.stringify(
        {
          ok,
          model: options.model,
          inputTokensPerStep: options.inputTokens,
          outputTokensPerStep: options.tokens,
          maxSteps: options.maxSteps,
          estimatedCostUsd: roundMoney(projectedCost),
          budgetUsd: options.budget,
        },
        null,
        2
      ) + '\n'
    );

    return ok ? 0 : 1;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n\n${helpText()}`);
    return 2;
  }
}

const defaultIO: CliIO = {
  stdout: (message) => process.stdout.write(message),
  stderr: (message) => process.stderr.write(message),
};

if (isCliEntry()) {
  process.exitCode = runCli();
}

function readRequiredNumber(options: Map<string, string>, key: string): number {
  const value = Number(options.get(key));
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`--${key} must be a non-negative number`);
  }
  return value;
}

function readOptionalNumber(options: Map<string, string>, key: string): number | undefined {
  if (!options.has(key)) return undefined;
  return readRequiredNumber(options, key);
}

function readRequiredString(options: Map<string, string>, key: string): string {
  const value = options.get(key);
  if (!value?.trim()) {
    throw new Error(`--${key} is required`);
  }
  return value;
}

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function helpText(): string {
  return [
    'Usage:',
    '  aifw check --budget <usd> --model <model> --tokens <output-tokens> --max-steps <n>',
    '  aifw dashboard --events .ai-costguard/events.jsonl --budget <usd>',
    '  ai-costguard dashboard --once --json',
    '',
    'Notes:',
    '  --tokens is per-step output tokens. Use --input-tokens for input token estimates.',
    '  For custom models, pass --input-price-per-1k and --output-price-per-1k.',
    '  The dashboard is local-only and reads an opt-in JSONL event log.',
    '  Exit code 0 means projected cost is within budget; 1 means over budget; 2 means usage/config error.',
    '',
  ].join('\n');
}

function readOptionalString(options: Map<string, string>, key: string): string | undefined {
  const value = options.get(key);
  return value?.trim() ? value.trim() : undefined;
}

function isCliEntry(): boolean {
  const entry = process.argv[1] ?? '';
  return /(^|[/\\])cli\.js$/u.test(entry);
}
