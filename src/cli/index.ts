#!/usr/bin/env node

/**
 * CLI Interface - AI Execution Firewall
 * 
 * This file contains ONLY interface logic.
 * ALL detection happens in DetectionEngine (single source of truth).
 * 
 * Flow:
 *   User Input → CLI → DetectionEngine.analyze() → Output
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { ProxyServer } from '../proxy';
import { ConfigManager } from '../config';
import { estimateMessagesTokens } from '../token-counter';
import { estimateCost, getModelPricing } from '../config';
import { detectionEngine } from '../core/DetectionEngine';
import { stateStore, RequestRecord } from '../core/StateStore';
import { logger } from '../logger';

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
    
    console.log(chalk.green(`🚀 Starting AI Execution Firewall on port ${port}...`));
    
    // Direct function invocation - NO process spawning
    const server = new ProxyServer(port);
    
    try {
      await server.start();
      console.log(chalk.green(`✅ Server running on port ${port}`));
      console.log(chalk.blue(`� Health check: http://localhost:${port}/health`));
      
      // Keep process alive
      process.stdin.resume();
      
      // Handle graceful shutdown
      process.on('SIGTERM', async () => {
        console.log(chalk.yellow('\n🛑 Received SIGTERM, shutting down...'));
        await server.stop();
        process.exit(0);
      });
      
      process.on('SIGINT', async () => {
        console.log(chalk.yellow('\n🛑 Received SIGINT, shutting down...'));
        await server.stop();
        process.exit(0);
      });
    } catch (err) {
      console.error(chalk.red('❌ Failed to start server:'), err);
      process.exit(1);
    }
  });

program
  .command('report')
  .description('View firewall protection statistics')
  .option('-h, --hours <hours>', 'Hours to report on', '24')
  .action((options) => {
    const hours = parseInt(options.hours) || 24;
    // DELEGATE to DetectionEngine (single source of truth)
    const stats = detectionEngine.getStats(hours);
    
    console.log('\ud83d\udcca FIREWALL PROTECTION REPORT');
    console.log('='.repeat(30));
    console.log(`Time Window: Last ${hours} hours`);
    console.log('');
    console.log(`Total Requests: ${stats.totalRequests}`);
    console.log(`Blocked: ${stats.blockedRequests}`);
    console.log(`Warned: ${stats.warnedRequests}`);
    console.log(`Total Cost: $${stats.totalCost.toFixed(4)}`);
    console.log(`Prevented Cost: $${stats.preventedCost.toFixed(4)}`);
    console.log('');
    if (stats.preventedCost > 0) {
      console.log(`\ud83d\udea8 $${stats.preventedCost.toFixed(4)} saved from ${stats.blockedRequests} blocked requests`);
    } else {
      console.log('\u2705 SAFE TO PROCEED - No dangerous requests');
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
      // DELEGATE to DetectionEngine (single source of truth)
      detectionEngine.clear();
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
    
    console.log('\u2699\ufe0f  FIREWALL CONFIGURATION');
    console.log('='.repeat(30));
    console.log(`${chalk.bold('Trust Mode:')} ${currentConfig.trustMode === 'block' ? chalk.red('BLOCK') : currentConfig.trustMode === 'warn' ? chalk.yellow('WARN') : chalk.green('MONITOR')}`);
    console.log(`${chalk.bold('Danger Threshold:')} ${currentConfig.dangerThreshold}%`);
    console.log(`${chalk.bold('Max Cost:')} $${currentConfig.maxCostPerRequest.toFixed(2)}`);
    console.log('');
    process.exit(0);
  });

program
  .command('blocked')
  .description('View firewall block log')
  .option('-n, --number <count>', 'Number of blocks to show', '10')
  .action((options) => {
    // DELEGATE to DetectionEngine (single source of truth)
    const blocked = detectionEngine.getBlocked(parseInt(options.number));
    
    console.log('\ud83d\udeab FIREWALL BLOCK LOG');
    console.log('='.repeat(30));

    if (blocked.length === 0) {
      console.log('No blocked requests in the last 24 hours');
    } else {
      console.log('Recent Blocks:');
      blocked.forEach((req: RequestRecord) => {
        const date = new Date(req.timestamp).toLocaleString();
        console.log(`[${date}] [${req.category}] ${req.prompt.substring(0, 50)} (Score: ${req.dangerScore})`);
      });
    }
    
    console.log('');
    process.exit(0);
  });

// ============================================================================
// Check command - instant safety analysis
// ALL detection logic is in DetectionEngine.analyze()
// This is just the interface layer
// ============================================================================
program
  .command('check <prompt>')
  .description('Check if a request is safe — see what the firewall would block')
  .option('-m, --model <model>', 'Model to analyze for', 'gpt-4')
  .option('-c, --context <size>', 'Context size in KB', '0')
  .action(async (prompt, options) => {
    const model = options.model || 'gpt-4';
    const contextSizeKB = parseInt(options.context) || 0;
    const context = contextSizeKB > 0 ? 'x'.repeat(contextSizeKB * 1024) : undefined;

    // Estimate tokens and cost
    const messages = [{ role: 'user', content: prompt }];
    const estimatedInputTokens = estimateMessagesTokens(messages);
    const estimatedOutputTokens = Math.ceil(estimatedInputTokens * 0.5);

    const pricing = getModelPricing(model);
    if (!pricing) {
      console.log(chalk.red(`❌ Unknown model: ${model}`));
      process.exit(1);
    }

    const estimatedCost = estimateCost(model, estimatedInputTokens, estimatedOutputTokens);

    // SINGLE SOURCE OF TRUTH: Call DetectionEngine
    const result = detectionEngine.analyze({
      model,
      prompt,
      estimatedCost,
      context,
      trustMode: 'warn',
      override: false
    });

    // Format output - match test expectations exactly
    console.log('\ud83d\udee1\ufe0f  AI EXECUTION FIREWALL');
    console.log(`Model: ${model}`);
    console.log(`Tokens: ${estimatedInputTokens} (est. $${estimatedCost.toFixed(4)})`);
    
    if (result.decision !== 'allow') {
      console.log('Status: \u26a0\ufe0f  DANGER DETECTED');
      console.log(`Danger Score: ${result.dangerScore}`);
      console.log(`Category: ${result.category}`);
      console.log(`Reason: ${result.reason}`);
    } else {
      console.log('Status: \u2705 SAFE TO PROCEED');
      console.log('Danger Score: 0');
    }
    
    console.log(`Estimated Cost: $${estimatedCost.toFixed(4)}`);
    process.exit(0);
  });

program.parse();
