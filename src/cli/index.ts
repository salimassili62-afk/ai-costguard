#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { randomUUID, createHash } from 'crypto';
import { ProxyServer } from '../proxy';
import { ConfigManager } from '../config';
import { estimateMessagesTokens } from '../token-counter';
import { estimateCost, getModelPricing } from '../config';
import {
  loadRequestHistory,
  getRecentRequestsByHash,
  getRecentRequests,
  appendRequest,
  getCLIStats,
  getBlockedRequests,
  clearHistory,
  CLIRequestRecord,
  CLIDetectionResult
} from './storage';

const program = new Command();

program
  .name('aifw')
  .description('AI Execution Firewall - Blocks dangerous AI requests before they execute')
  .version('1.0.0');

program
  .command('start')
  .description('Start the AI Execution Firewall proxy server')
  .option('-p, --port <port>', 'Port to run the proxy on', '3000')
  .action(async (options) => {
    const port = parseInt(options.port, 10);
    const server = new ProxyServer(port);
    server.start();
  });

program
  .command('report')
  .description('View firewall protection statistics')
  .option('-h, --hours <hours>', 'Hours to report on', '24')
  .action((options) => {
    const hours = parseInt(options.hours) || 24;
    const stats = getCLIStats(hours);
    
    console.log(chalk.red.bold('\n🛡️  FIREWALL PROTECTION REPORT\n'));
    console.log(chalk.gray(`Last ${hours} hours\n`));
    
    console.log(`${chalk.bold('Total Requests:')} ${chalk.cyan(stats.totalRequests)}`);
    console.log(`${chalk.bold('Blocked Requests:')} ${chalk.red(stats.blockedRequests)}`);
    console.log(`${chalk.bold('Warned Requests:')} ${chalk.yellow(stats.warnedRequests)}`);
    console.log(`${chalk.bold('Total Cost:')} $${chalk.green(stats.totalCost.toFixed(4))}`);
    console.log(`${chalk.bold('Loss Prevented:')} ${chalk.green.bold('$' + stats.preventedCost.toFixed(4))}`);
    
    if (stats.preventedCost > 0) {
      console.log(chalk.red.bold(`\n🚨 FIREWALL PROTECTION ACTIVE\n$${stats.preventedCost.toFixed(4)} saved from ${chalk.yellow(stats.blockedRequests)} blocked dangerous requests\n`));
    } else {
      console.log(chalk.green('\n✅ No dangerous requests detected — Firewall is operating normally\n'));
    }
    
    console.log('');
    process.exit(0);
  });

program
  .command('config')
  .description('Configure firewall protection settings')
  .option('--trust-mode <mode>', 'Trust mode: monitor, warn, or block')
  .option('--max-cost <amount>', 'Maximum cost threshold per request')
  .option('--danger-threshold <percentage>', 'Danger threshold percentage')
  .option('--reset', 'Reset to default protection settings')
  .option('--clear-history', 'Clear all request history')
  .action((options) => {
    const config = new ConfigManager();
    const currentConfig = config.getConfig();
    
    if (options.reset) {
      config.resetConfig();
      console.log(chalk.green('✅ Firewall reset to default protection settings'));
      return;
    }
    
    if (options.clearHistory) {
      clearHistory();
      console.log(chalk.green('✅ Request history cleared'));
      return;
    }
    
    if (options.trustMode !== undefined) {
      const validModes = ['monitor', 'warn', 'block'];
      if (validModes.includes(options.trustMode)) {
        config.updateConfig({ trustMode: options.trustMode as 'monitor' | 'warn' | 'block' });
      } else {
        console.log(chalk.red('Invalid trust mode. Use: monitor, warn, or block'));
        return;
      }
    }
    
    if (options.maxCost !== undefined) {
      config.updateConfig({ maxCostPerRequest: parseFloat(options.maxCost) });
    }
    
    if (options.dangerThreshold !== undefined) {
      config.updateConfig({ dangerThreshold: parseInt(options.dangerThreshold) });
    }
    
    console.log(chalk.red.bold('\n🛡️  FIREWALL PROTECTION SETTINGS\n'));
    console.log(`${chalk.bold('Trust Mode:')} ${currentConfig.trustMode === 'block' ? chalk.red('BLOCK') : currentConfig.trustMode === 'warn' ? chalk.yellow('WARN') : chalk.green('MONITOR')}`);
    console.log(`${chalk.bold('Max Cost Per Request:')} $${currentConfig.maxCostPerRequest.toFixed(2)}`);
    console.log(`${chalk.bold('Danger Threshold:')} ${currentConfig.dangerThreshold}%`);
    console.log(`${chalk.bold('Override Allowed:')} ${currentConfig.allowOverride ? 'Yes' : 'No'}`);
    console.log(`${chalk.bold('Firewall Port:')} ${currentConfig.proxyPort}`);
    console.log('');
    process.exit(0);
  });

program
  .command('blocked')
  .description('View firewall block log')
  .option('-n, --number <count>', 'Number of blocks to show', '10')
  .action((options) => {
    const blocked = getBlockedRequests(parseInt(options.number));
    
    console.log(chalk.red.bold('\n🛡️  FIREWALL BLOCK LOG\n'));
    
    if (blocked.length === 0) {
      console.log(chalk.gray('No dangerous requests blocked yet — Firewall is protecting'));
    } else {
      blocked.forEach((req, i) => {
        const date = new Date(req.timestamp).toLocaleString();
        console.log(chalk.bold(`${i + 1}. ${req.model} - ${date}`));
        console.log(chalk.red(`   🛑 BLOCKED - Loss prevented: $${req.estimatedCost.toFixed(4)}`));
        console.log(chalk.gray(`   Danger level: ${req.dangerScore}% | Reason: ${req.reason || 'Danger threshold exceeded'}\n`));
      });
    }
    
    console.log('');
    process.exit(0);
  });

// ============================================================================
// Check command - instant safety analysis with PERSISTENT storage
// ============================================================================
program
  .command('check <prompt>')
  .description('Check if a request is safe — see what the firewall would block')
  .option('-m, --model <model>', 'Model to analyze for', 'gpt-4')
  .option('-c, --context <size>', 'Context size in KB', '0')
  .action(async (prompt, options) => {
    console.log(chalk.red.bold('\n🛡️  AI EXECUTION FIREWALL - SAFETY CHECK\n'));

    const model = options.model || 'gpt-4';
    const contextSizeKB = parseInt(options.context) || 0;
    const context = contextSizeKB > 0 ? 'x'.repeat(contextSizeKB * 1024) : undefined;

    // Estimate tokens
    const messages = [{ role: 'user', content: prompt }];
    const estimatedInputTokens = estimateMessagesTokens(messages);
    const estimatedOutputTokens = Math.ceil(estimatedInputTokens * 0.5);

    const pricing = getModelPricing(model);
    if (!pricing) {
      console.log(chalk.red(`❌ Unknown model: ${model}`));
      console.log(chalk.gray('\nSupported models: gpt-4, gpt-4-turbo, gpt-4o, gpt-3.5-turbo, claude-3-opus-20240229, claude-3-sonnet-20240229, claude-3-haiku-20240307'));
      return;
    }

    const estimatedCost = estimateCost(model, estimatedInputTokens, estimatedOutputTokens);

    // PERSISTENT STATE: Load history and detect
    const promptHash = createHash('sha256').update(prompt + (context || '')).digest('hex');
    const now = Date.now();
    
    // Check for duplicates/loops using persistent storage
    const recentDuplicates = getRecentRequestsByHash(promptHash, 30000); // 30 sec window for loops
    const hourDuplicates = getRecentRequestsByHash(promptHash, 3600000); // 1 hour for duplicates
    
    // Build detection result from persistent history
    let riskAnalysis: CLIDetectionResult = {
      isDangerous: false,
      dangerScore: 0,
      category: 'safe',
      reason: 'Request is safe',
      action: 'allow'
    };
    
    // Check 1: Runaway loop (3+ in 30 seconds)
    if (recentDuplicates.length >= 3) {
      riskAnalysis = {
        isDangerous: true,
        dangerScore: Math.min(100, 90 + recentDuplicates.length * 3),
        category: 'loop',
        reason: `🔴 KILL SWITCH: RUNAWAY LOOP - ${recentDuplicates.length + 1} identical requests in 30 seconds`,
        action: 'block'
      };
    }
    // Check 2: Duplicate (1+ in 1 hour)
    else if (hourDuplicates.length > 0) {
      const dupCount = hourDuplicates.length;
      riskAnalysis = {
        isDangerous: true,
        dangerScore: Math.min(90, 40 + dupCount * 10),
        category: 'duplicate',
        reason: `💸 DUPLICATE: This exact prompt was sent ${dupCount} time(s) in the last hour`,
        action: 'block'
      };
    }
    // Check 3: Cost spike
    else if (estimatedCost >= 0.05) {
      const baseScore = 30;
      const costMultiplier = (estimatedCost - 0.05) * 50;
      const dangerScore = Math.min(100, baseScore + costMultiplier);
      riskAnalysis = {
        isDangerous: true,
        dangerScore,
        category: 'spike',
        reason: `💸 COST SPIKE: Single request costs $${estimatedCost.toFixed(2)}`,
        action: dangerScore >= 90 ? 'block' : 'warn'
      };
    }
    // Check 4: Context explosion
    else if (context && prompt) {
      const contextRatio = context.length / (prompt.length || 1);
      if (contextRatio >= 5) {
        riskAnalysis = {
          isDangerous: true,
          dangerScore: Math.min(75, 25 + Math.log(contextRatio) * 15),
          category: 'context',
          reason: `💸 CONTEXT EXPLOSION: Context is ${contextRatio.toFixed(1)}x larger than prompt`,
          action: 'warn'
        };
      }
    }
    
    // Fuzzy duplicate check (similar prompts in last hour)
    if (!riskAnalysis.isDangerous) {
      const recentRecords = getRecentRequests(3600000);
      for (const record of recentRecords) {
        const similarity = calculateSimilarity(prompt, record.prompt);
        if (similarity >= 0.70 && record.prompt !== prompt) {
          riskAnalysis = {
            isDangerous: true,
            dangerScore: Math.min(70, 30 + similarity * 40),
            category: 'fuzzy_duplicate',
            reason: `⚠️ SIMILAR PROMPT: ${(similarity * 100).toFixed(0)}% similar to a recent request`,
            action: 'warn'
          };
          break;
        }
      }
    }

    // PERSISTENT STATE: Append this request to history
    const record: CLIRequestRecord = {
      id: randomUUID(),
      timestamp: now,
      model,
      prompt,
      promptHash,
      estimatedCost,
      dangerScore: riskAnalysis.dangerScore,
      isDangerous: riskAnalysis.isDangerous,
      category: riskAnalysis.category,
      wasBlocked: riskAnalysis.action === 'block',
      wasWarned: riskAnalysis.isDangerous,
      reason: riskAnalysis.reason
    };
    appendRequest(record);

    // Format output - emotional + financial
    console.log(chalk.gray(`${'─'.repeat(50)}`));
    console.log(`${chalk.bold('Model:')} ${chalk.cyan(model)}`);
    console.log(`${chalk.bold('Tokens:')} ${chalk.yellow(estimatedInputTokens.toLocaleString())} input + ${chalk.yellow(estimatedOutputTokens.toLocaleString())} output`);
    console.log(`${chalk.bold('Estimated Cost:')} ${chalk.yellow.bold(`$${estimatedCost.toFixed(4)}`)}`);
    console.log(chalk.gray(`${'─'.repeat(50)}\n`));

    if (riskAnalysis.isDangerous) {
      if (riskAnalysis.dangerScore >= 90) {
        console.log(chalk.red.bold.bgWhite(`\n🔴 KILL SWITCH TRIGGERED\n`));
        console.log(chalk.red.bold(`Severity: CRITICAL`));
        console.log(chalk.red.bold(`Danger Score: ${riskAnalysis.dangerScore}/100\n`));
      } else {
        console.log(chalk.yellow.bold(`\n⚠️  DANGER DETECTED (Score: ${riskAnalysis.dangerScore}/100)\n`));
        console.log(chalk.yellow(`Category: ${riskAnalysis.category}\n`));
      }
      
      console.log(chalk.white(`${riskAnalysis.reason}`));
      console.log(chalk.green.bold(`\n💸 MONEY AT RISK: $${estimatedCost.toFixed(4)}`));
      
      if (riskAnalysis.action === 'block') {
        console.log(chalk.red.bold(`\n� This request would be BLOCKED in block mode\n`));
      } else {
        console.log(chalk.yellow(`\n⚠️  This request would trigger a WARNING in block mode\n`));
      }
    } else {
      console.log(chalk.green.bold(`\n✅ SAFE TO PROCEED\n`));
      console.log(chalk.gray(`This request passes all safety checks.`));
      console.log(chalk.gray(`No cost waste detected.`));
      console.log(chalk.green(`\n💰 Your budget is protected!\n`));
    }

    console.log(chalk.gray(`${'─'.repeat(50)}`));
    console.log(chalk.gray(`💡 Start Firewall: ${chalk.cyan('aifw start')} to protect all your AI API calls\n`));
    process.exit(0);
  });

// Helper function for fuzzy similarity
function calculateSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 1;

  const len1 = Math.min(str1.length, 500);
  const len2 = Math.min(str2.length, 500);
  const s1 = str1.substring(0, len1);
  const s2 = str2.substring(0, len2);

  const matrix: number[][] = [];
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const distance = matrix[len1][len2];
  const maxLength = Math.max(len1, len2);
  return 1 - distance / maxLength;
}

program.parse();
