#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { ProxyServer } from '../proxy';
import { ConfigManager } from '../config';
import { sharedState } from '../core/SharedState';
import { estimateTokens, estimateMessagesTokens } from '../token-counter';
import { estimateCost, getModelPricing } from '../config';

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
    const detector = sharedState.getWasteDetector();
    const hours = parseInt(options.hours) || 24;
    const stats = detector.getStats(hours);
    
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
    detector.destroy();
  });

program
  .command('config')
  .description('Configure firewall protection settings')
  .option('--trust-mode <mode>', 'Trust mode: monitor, warn, or block')
  .option('--max-cost <amount>', 'Maximum cost threshold per request')
  .option('--danger-threshold <percentage>', 'Danger threshold percentage')
  .option('--reset', 'Reset to default protection settings')
  .action((options) => {
    const config = new ConfigManager();
    const currentConfig = config.getConfig();
    
    if (options.reset) {
      config.resetConfig();
      console.log(chalk.green('✅ Firewall reset to default protection settings'));
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
  });

program
  .command('blocked')
  .description('View firewall block log')
  .option('-n, --number <count>', 'Number of blocks to show', '10')
  .action((options) => {
    const detector = sharedState.getWasteDetector();
    const blocked = detector.getBlockedRequests(parseInt(options.number));
    
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
    detector.destroy();
  });

// ============================================================================
// Check command - instant safety analysis
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

    // Analyze for danger
    const detector = sharedState.getWasteDetector();
    const riskAnalysis = detector.detect(model, prompt, estimatedCost, context, 'warn', false);

    // Format output - emotional + financial
    console.log(chalk.gray(`${'─'.repeat(50)}`));
    console.log(`${chalk.bold('Model:')} ${chalk.cyan(model)}`);
    console.log(`${chalk.bold('Tokens:')} ${chalk.yellow(estimatedInputTokens.toLocaleString())} input + ${chalk.yellow(estimatedOutputTokens.toLocaleString())} output`);
    console.log(`${chalk.bold('Estimated Cost:')} ${chalk.yellow.bold(`$${estimatedCost.toFixed(4)}`)}`);
    console.log(chalk.gray(`${'─'.repeat(50)}\n`));

    if (riskAnalysis.isDangerous) {
      if (riskAnalysis.killSwitchTriggered) {
        console.log(chalk.red.bold.bgWhite(`\n� KILL SWITCH TRIGGERED\n`));
        console.log(chalk.red.bold(`Severity: CRITICAL`));
        console.log(chalk.red.bold(`Danger Score: ${riskAnalysis.dangerScore}/100\n`));
      } else {
        console.log(chalk.yellow.bold(`\n⚠️  DANGER DETECTED (Score: ${riskAnalysis.dangerScore}/100)\n`));
        console.log(chalk.yellow(`Severity: ${riskAnalysis.severity}\n`));
      }
      
      console.log(chalk.white(`${riskAnalysis.reason}`));
      console.log(chalk.green.bold(`\n💸 MONEY AT RISK: $${riskAnalysis.estimatedLoss.toFixed(4)}`));
      
      if (riskAnalysis.suggestions.length > 0) {
        console.log(chalk.cyan(`\n💡 HOW TO FIX:`));
        riskAnalysis.suggestions.forEach((s, i) => console.log(chalk.cyan(`   ${i + 1}. ${s}`)));
      }
      
      console.log(chalk.red.bold(`\n🛑 This request would be BLOCKED in block mode\n`));
    } else {
      console.log(chalk.green.bold(`\n✅ SAFE TO PROCEED\n`));
      console.log(chalk.gray(`This request passes all safety checks.`));
      console.log(chalk.gray(`No cost waste detected.`));
      console.log(chalk.green(`\n💰 Your budget is protected!\n`));
    }

    console.log(chalk.gray(`${'─'.repeat(50)}`));
    console.log(chalk.gray(`💡 Start Firewall: ${chalk.cyan('aifw start')} to protect all your AI API calls\n`));
    
    // Cleanup
    detector.destroy();
  });

program.parse();
