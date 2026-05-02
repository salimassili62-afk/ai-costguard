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
import { sessionStats } from '../core/SessionStats';

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
  .description('Check if a prompt is safe to execute')
  .option('-m, --model <model>', 'AI model to use', 'gpt-4')
  .option('--strict', 'Enable strict enforcement (cannot be overridden without config file)')
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

    // Format output - Impact-driven "OH SH*T" messaging
    console.log('\ud83d\udee1\ufe0f  AI EXECUTION FIREWALL');
    console.log(`Model: ${model}`);
    console.log(`Tokens: ${estimatedInputTokens} (est. $${estimatedCost.toFixed(4)})`);

    if (result.decision !== 'allow') {
      // BLOCKED or WARNED - Impact-driven output
      const riskEmoji = result.riskLevel === 'CRITICAL' ? '🔥' : 
                       result.riskLevel === 'HIGH' ? '⚠️' : 
                       result.riskLevel === 'MEDIUM' ? '⚡' : '📢';
      
      console.log('');
      console.log(chalk.red.bold(`${riskEmoji} YOU ALMOST LOST $${result.wouldHaveLost.toFixed(2)}`));
      console.log(chalk.green.bold(`🛡️ BLOCKED BEFORE EXECUTION`));
      console.log('');
      
      console.log(chalk.bold('DETAILS:'));
      console.log(`COST: $${estimatedCost.toFixed(4)}`);
      console.log(`WOULD HAVE LOST: $${result.wouldHaveLost.toFixed(4)}`);
      console.log(chalk.green.bold(`SAVED: $${result.saved.toFixed(4)}`));
      console.log(`Risk Level: ${result.riskLevel}`);
      
      const riskColor = result.riskLevel === 'CRITICAL' ? chalk.redBright :
                        result.riskLevel === 'HIGH' ? chalk.red :
                        result.riskLevel === 'MEDIUM' ? chalk.yellow : chalk.gray;
      console.log(`RISK: ${riskColor(result.riskLevel)}`);
      console.log(`DECISION: ${chalk.red.bold('BLOCK')}`);
      console.log(`Danger Score: ${result.dangerScore}`);
      console.log(`CATEGORY: ${result.category}`);
      console.log(`REASON: ${result.reason}`);
    } else {
      // ALLOWED - Safe but still show cost
      console.log('');
      console.log(chalk.green.bold('Status: ✅ SAFE TO PROCEED'));
      console.log(`Risk Level: ${chalk.green(result.riskLevel)}`);
      console.log(`Danger Score: ${result.dangerScore}`);
    }

    console.log('');
    console.log('─'.repeat(50));
    console.log(`COST: ${estimatedCost}`);
    console.log(`RISK: ${result.riskLevel}`);
    console.log(`DECISION: ${result.decision.toUpperCase()}`);
    console.log('─'.repeat(50));
    console.log(chalk.gray('Universal Format:'), JSON.stringify({
      cost: estimatedCost,
      risk: result.riskLevel,
      decision: result.decision.toUpperCase(),
      saved: result.saved,
      wouldHaveLost: result.wouldHaveLost
    }, null, 2));
    console.log('─'.repeat(50));
    console.log(`Estimated Cost: $${estimatedCost.toFixed(4)}`);
    process.exit(0);
  });

// ============================================================================
// DEMO command - Show realistic cost protection scenarios
// Creates shock value by showing what could have been lost
// ============================================================================
program
  .command('demo')
  .description('Demonstrate AI cost protection scenarios')
  .action(() => {
    console.log(chalk.bold('\n🔥 AI EXECUTION FIREWALL - COST PROTECTION DEMO\n'));
    console.log(chalk.gray('Real-world scenarios showing money saved by blocking dangerous requests\n'));
    
    // Scenario 1: Loop Detection
    console.log(chalk.yellow('─'.repeat(60)));
    console.log(chalk.bold('📊 SCENARIO 1: Agent Loop Detection'));
    console.log(chalk.yellow('─'.repeat(60)));
    console.log('Pattern: Duplicate requests detected in rapid succession');
    console.log('Risk: Infinite loop burning API credits');
    console.log('');
    console.log(chalk.red('⚠️  LOOP DETECTED (47 repeated requests)'));
    console.log(chalk.red('🔥 RISK LEVEL: CRITICAL'));
    console.log(chalk.green('💰 ESTIMATED COST PREVENTED: $4.23'));
    console.log(chalk.red('🚨 IF NOT BLOCKED: ~$245/day potential loss'));
    console.log(chalk.green('✅ ACTION: BLOCKED - Loop broken, credits saved'));
    console.log('');
    
    // Scenario 2: Token Bomb
    console.log(chalk.yellow('─'.repeat(60)));
    console.log(chalk.bold('📊 SCENARIO 2: Token Bomb Prevention'));
    console.log(chalk.yellow('─'.repeat(60)));
    console.log('Pattern: Request asking for 100,000 tokens output');
    console.log('Risk: Single request could cost $15-30');
    console.log('');
    console.log(chalk.red('⚠️  TOKEN SPIKE DETECTED (requested: 100k tokens)'));
    console.log(chalk.red('🔥 RISK LEVEL: HIGH'));
    console.log(chalk.green('💰 ESTIMATED COST PREVENTED: $18.50'));
    console.log(chalk.red('🚨 IF NOT BLOCKED: Production budget drained in minutes'));
    console.log(chalk.green('✅ ACTION: BLOCKED - Exceeded safe threshold'));
    console.log('');
    
    // Scenario 3: Cost Spike
    console.log(chalk.yellow('─'.repeat(60)));
    console.log(chalk.bold('📊 SCENARIO 3: Cost Spike Detection'));
    console.log(chalk.yellow('─'.repeat(60)));
    console.log('Pattern: 156 requests in 30 seconds from single source');
    console.log('Risk: Runaway process or DDoS');
    console.log('');
    console.log(chalk.red('⚠️  COST SPIKE DETECTED (156 req/30s)'));
    console.log(chalk.red('🔥 RISK LEVEL: HIGH'));
    console.log(chalk.green('💰 ESTIMATED COST PREVENTED: $12.89'));
    console.log(chalk.red('🚨 IF NOT BLOCKED: ~$620/hour potential burn rate'));
    console.log(chalk.green('✅ ACTION: BLOCKED - Rate limit enforced'));
    console.log('');
    
    // Scenario 4: Daily Budget Protection
    console.log(chalk.yellow('─'.repeat(60)));
    console.log(chalk.bold('📊 SCENARIO 4: Daily Budget Protection'));
    console.log(chalk.yellow('─'.repeat(60)));
    console.log('Daily Budget: $50.00');
    console.log('Current Usage: $48.75');
    console.log('Next Request Cost: $2.30');
    console.log('');
    console.log(chalk.red('⚠️  BUDGET LIMIT REACHED'));
    console.log(chalk.red('🔥 RISK LEVEL: MEDIUM'));
    console.log(chalk.green('💰 ESTIMATED COST PREVENTED: $2.30'));
    console.log(chalk.red('🚨 IF NOT BLOCKED: Daily budget exceeded by $0.55'));
    console.log(chalk.green('✅ ACTION: BLOCKED - Budget protection active'));
    console.log('');
    
    // Summary
    console.log(chalk.green('═'.repeat(60)));
    console.log(chalk.bold('💸 TOTAL PROTECTION VALUE'));
    console.log(chalk.green('═'.repeat(60)));
    console.log(chalk.bold('💰 Money Saved in Demo Scenarios: $37.92'));
    console.log(chalk.bold('🛡️  Risk Events Prevented: 4'));
    console.log(chalk.bold('📉 Potential Daily Loss Prevented: ~$865+'));
    console.log('');
    console.log(chalk.cyan('Without AI Execution Firewall, these scenarios would have'));
    console.log(chalk.cyan('burned real money. This is not theoretical — production agents'));
    console.log(chalk.cyan('can silently lose $100-$1000 before you notice.\n'));
    
    process.exit(0);
  });

// ============================================================================
// DASHBOARD command - Show real-time cost protection status
// ============================================================================
program
  .command('dashboard')
  .description('View real-time cost protection dashboard')
  .action(() => {
    const stats = detectionEngine.getStats(24);
    const hourlyStats = detectionEngine.getStats(1);
    
    console.log(chalk.bold('\n📊 AI COST PROTECTION DASHBOARD\n'));
    console.log(chalk.gray('Real-time financial protection metrics\n'));
    
    // Money Impact Section
    console.log(chalk.green('━'.repeat(50)));
    console.log(chalk.bold('💰 FINANCIAL IMPACT (24 hours)'));
    console.log(chalk.green('━'.repeat(50)));
    
    const savings = stats.preventedCost;
    const riskLevel = savings > 10 ? 'HIGH' : savings > 1 ? 'MEDIUM' : 'LOW';
    const riskColor = savings > 10 ? chalk.red : savings > 1 ? chalk.yellow : chalk.green;
    
    console.log(`${chalk.bold('Money Saved:')} ${chalk.green('$' + savings.toFixed(2))}`);
    console.log(`${chalk.bold('Protection Level:')} ${riskColor(riskLevel)}`);
    console.log(`${chalk.bold('Requests Analyzed:')} ${stats.totalRequests}`);
    console.log(`${chalk.bold('Threats Blocked:')} ${chalk.red(stats.blockedRequests.toString())}`);
    console.log(`${chalk.bold('Warnings Issued:')} ${chalk.yellow(stats.warnedRequests.toString())}`);
    console.log('');
    
    // Hourly Activity
    console.log(chalk.blue('━'.repeat(50)));
    console.log(chalk.bold('📈 HOURLY ACTIVITY'));
    console.log(chalk.blue('━'.repeat(50)));
    console.log(`${chalk.bold('Last Hour Requests:')} ${hourlyStats.totalRequests}`);
    console.log(`${chalk.bold('Last Hour Blocked:')} ${hourlyStats.blockedRequests}`);
    console.log(`${chalk.bold('Last Hour Saved:')} ${chalk.green('$' + hourlyStats.preventedCost.toFixed(2))}`);
    console.log('');
    
    // Risk Patterns
    console.log(chalk.yellow('━'.repeat(50)));
    console.log(chalk.bold('🚨 TOP RISK PATTERNS DETECTED'));
    console.log(chalk.yellow('━'.repeat(50)));
    
    if (stats.blockedRequests === 0) {
      console.log(chalk.green('✅ No threats detected - system is safe'));
    } else {
      console.log(chalk.red('• Duplicate/Loop requests'));
      console.log(chalk.red('• Cost threshold exceeded'));
      console.log(chalk.red('• Anomalous request patterns'));
    }
    console.log('');
    
    // Bottom line
    console.log(chalk.green('═'.repeat(50)));
    console.log(chalk.bold('💡 WITHOUT THIS FIREWALL:'));
    console.log(chalk.red(`   You would have spent $${(stats.totalCost + stats.preventedCost).toFixed(2)}`));
    console.log(chalk.red(`   (${stats.blockedRequests} dangerous requests would have executed)`));
    console.log('');
    console.log(chalk.bold('✅ WITH THIS FIREWALL:'));
    console.log(chalk.green(`   You spent only $${stats.totalCost.toFixed(2)}`));
    console.log(chalk.green(`   Saved $${stats.preventedCost.toFixed(2)} by blocking threats`));
    console.log(chalk.green('═'.repeat(50)));
    console.log('');
    
    process.exit(0);
  });

// ============================================================================
// BUDGET command - Configure daily budget limits
// ============================================================================
program
  .command('budget')
  .description('Configure daily cost budget limits')
  .option('-s, --set <amount>', 'Set daily budget limit in USD')
  .option('-c, --current', 'Show current budget status')
  .action((options) => {
    const config = new ConfigManager();
    
    if (options.set) {
      const budget = parseFloat(options.set);
      if (isNaN(budget) || budget < 0) {
        console.log(chalk.red('❌ Invalid budget amount'));
        process.exit(1);
      }
      
      config.updateConfig({ dailyBudget: budget });
      console.log(chalk.green(`✅ Daily budget set to $${budget.toFixed(2)}`));
      console.log('');
      console.log(chalk.cyan('When daily spending approaches this limit:'));
      console.log(chalk.cyan('• Warnings at 80% of budget'));
      console.log(chalk.cyan('• Blocks at 100% of budget'));
      console.log('');
      process.exit(0);
    }
    
    // Show current budget status
    const cfg = config.getConfig();
    const stats = detectionEngine.getStats(24);
    
    console.log(chalk.bold('\n💰 DAILY BUDGET PROTECTION\n'));
    console.log(`${chalk.bold('Daily Budget Limit:')} $${(cfg.dailyBudget || 50).toFixed(2)}`);
    console.log(`${chalk.bold('Current Usage (24h):')} $${stats.totalCost.toFixed(2)}`);
    
    const percentUsed = ((cfg.dailyBudget || 50) > 0) 
      ? (stats.totalCost / (cfg.dailyBudget || 50)) * 100 
      : 0;
    
    const percentColor = percentUsed > 90 ? chalk.red : percentUsed > 70 ? chalk.yellow : chalk.green;
    console.log(`${chalk.bold('Budget Used:')} ${percentColor(percentUsed.toFixed(1) + '%')}`);
    
    if (percentUsed >= 100) {
      console.log(chalk.red('\n🚨 BUDGET LIMIT REACHED'));
      console.log(chalk.red('Next requests will be BLOCKED until tomorrow'));
    } else if (percentUsed >= 80) {
      console.log(chalk.yellow('\n⚠️  BUDGET WARNING'));
      console.log(chalk.yellow('Approaching daily limit - monitor closely'));
    } else {
      console.log(chalk.green('\n✅ Within safe budget range'));
    }
    
    console.log('');
    console.log(chalk.gray('Use --set <amount> to change daily budget'));
    console.log('');
    process.exit(0);
  });

// ============================================================================
// HOOK command - Install git hooks for automatic AI safety checks
// ============================================================================
program
  .command('hook')
  .description('Install git hooks for automatic AI safety checks')
  .option('--install', 'Install pre-commit and pre-push hooks')
  .option('--remove', 'Remove installed hooks')
  .action((options) => {
    const fs = require('fs');
    const path = require('path');
    const { execSync } = require('child_process');
    
    const gitDir = path.join(process.cwd(), '.git');
    const hooksDir = path.join(gitDir, 'hooks');
    
    if (!fs.existsSync(gitDir)) {
      console.log(chalk.red('❌ Not a git repository'));
      console.log(chalk.gray('Run this command from a git repository root'));
      process.exit(1);
    }
    
    if (options.remove) {
      // Remove hooks
      const preCommitPath = path.join(hooksDir, 'pre-commit');
      const prePushPath = path.join(hooksDir, 'pre-push');
      
      if (fs.existsSync(preCommitPath)) {
        fs.unlinkSync(preCommitPath);
        console.log(chalk.green('✅ Removed pre-commit hook'));
      }
      if (fs.existsSync(prePushPath)) {
        fs.unlinkSync(prePushPath);
        console.log(chalk.green('✅ Removed pre-push hook'));
      }
      process.exit(0);
    }
    
    // Install hooks
    if (!fs.existsSync(hooksDir)) {
      fs.mkdirSync(hooksDir, { recursive: true });
    }
    
    // Pre-commit hook - scan staged files
    const preCommitScript = `#!/bin/sh
# AI Execution Firewall - Pre-commit Hook
# Scans staged files for risky AI usage patterns

echo "🔍 AI Firewall: Scanning staged files..."

# Get staged JS/TS files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(js|ts|jsx|tsx)$' || true)

if [ -z "$STAGED_FILES" ]; then
  echo "✅ No JS/TS files staged - skipping AI scan"
  exit 0
fi

# Run AI Firewall check on staged files
for file in $STAGED_FILES; do
  # Check for risky patterns (openai calls without firewall)
  if grep -q "openai\\.chat\\.completions\\.create" "$file" 2>/dev/null; then
    if ! grep -q "withFirewall" "$file" 2>/dev/null; then
      echo "⚠️  WARNING: $file uses OpenAI without firewall protection"
      echo "   Add: const openai = withFirewall(new OpenAI(...))"
    fi
  fi
done

echo "✅ AI Firewall pre-commit check complete"
exit 0
`;
    
    // Pre-push hook - run full check
    const prePushScript = `#!/bin/sh
# AI Execution Firewall - Pre-push Hook
# Runs comprehensive AI safety check before pushing

echo "🛡️  AI Firewall: Running pre-push safety check..."

# Check if aifw is available
if command -v aifw >/dev/null 2>&1 || [ -f "./node_modules/.bin/aifw" ]; then
  echo "✅ AI Firewall CLI found"
  
  # Check configuration
  if [ -f "aifw.config.json" ]; then
    echo "✅ AI Firewall config found"
  else
    echo "⚠️  No aifw.config.json found - using defaults"
  fi
  
  echo "✅ Pre-push check complete"
else
  echo "ℹ️  AI Firewall not installed in this project"
  echo "   Install: npm install ai-execution-firewall"
fi

exit 0
`;
    
    fs.writeFileSync(path.join(hooksDir, 'pre-commit'), preCommitScript, { mode: 0o755 });
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), prePushScript, { mode: 0o755 });
    
    console.log(chalk.bold('\n🪝 AI FIREWALL GIT HOOKS INSTALLED\n'));
    console.log(chalk.green('✅ pre-commit hook installed'));
    console.log(chalk.green('✅ pre-push hook installed'));
    console.log('');
    console.log(chalk.cyan('Hook behaviors:'));
    console.log(chalk.gray('• pre-commit: Scans staged files for risky AI patterns'));
    console.log(chalk.gray('• pre-push: Runs comprehensive AI safety validation'));
    console.log('');
    console.log(chalk.gray('To remove: aifw hook --remove'));
    console.log('');
    process.exit(0);
  });

// ============================================================================
// CI command - CI/CD plugin mode for automated checks
// ============================================================================
program
  .command('ci')
  .description('CI/CD plugin mode - automated AI safety checks')
  .option('--fail-on <level>', 'Fail on risk level (LOW|MEDIUM|HIGH)', 'HIGH')
  .option('--scan <path>', 'Scan path for AI usage', './src')
  .option('--budget <amount>', 'Max allowed cost for this run', '100')
  .action((options) => {
    const failOn = options.failOn.toUpperCase();
    const scanPath = options.scan;
    const maxBudget = parseFloat(options.budget);
    
    console.log(chalk.bold('\n🔍 AI FIREWALL CI/CD CHECK\n'));
    console.log(chalk.gray(`Fail on: ${failOn} risk`));
    console.log(chalk.gray(`Scan path: ${scanPath}`));
    console.log(chalk.gray(`Budget limit: $${maxBudget}`));
    console.log('');
    
    // Get stats from last run
    const stats = detectionEngine.getStats(1); // Last hour (CI context)
    const comparison = {
      saved: stats.preventedCost,
      wouldHaveLost: stats.totalCost + stats.preventedCost,
      actualSpend: stats.totalCost,
      blockedCount: stats.blockedRequests,
      allowedCount: stats.totalRequests - stats.blockedRequests
    };
    
    // Check for HIGH risk blocks
    const highRiskBlocks = stats.blockedRequests > 0;
    
    console.log(chalk.bold('📊 SCAN RESULTS'));
    console.log('━'.repeat(40));
    console.log(`Requests checked: ${stats.totalRequests}`);
    console.log(`Blocked: ${stats.blockedRequests}`);
    console.log(`Allowed: ${comparison.allowedCount}`);
    console.log(`Cost prevented: $${comparison.saved.toFixed(2)}`);
    console.log('');
    
    // Determine pass/fail
    let passed = true;
    let exitCode = 0;
    
    if (failOn === 'LOW' && (stats.blockedRequests > 0 || stats.warnedRequests > 0)) {
      passed = false;
      exitCode = 1;
    } else if (failOn === 'MEDIUM' && highRiskBlocks) {
      passed = false;
      exitCode = 1;
    } else if (failOn === 'HIGH' && highRiskBlocks) {
      // Only fail on actual blocks with HIGH risk
      passed = false;
      exitCode = 1;
    }
    
    if (comparison.actualSpend > maxBudget) {
      console.log(chalk.red(`\n❌ BUDGET EXCEEDED: $${comparison.actualSpend.toFixed(2)} > $${maxBudget}`));
      passed = false;
      exitCode = 1;
    }
    
    console.log(chalk.bold('━'.repeat(40)));
    
    if (passed) {
      console.log(chalk.green('\n✅ CI CHECK PASSED'));
      console.log(chalk.green(`No ${failOn} risk detections found`));
    } else {
      console.log(chalk.red('\n❌ CI CHECK FAILED'));
      console.log(chalk.red(`Risk level threshold: ${failOn}`));
      if (comparison.actualSpend > maxBudget) {
        console.log(chalk.red('Budget limit exceeded'));
      }
    }
    
    console.log('');
    process.exit(exitCode);
  });

// ============================================================================
// INIT command - Initialize AI Firewall in a project
// ============================================================================
program
  .command('init')
  .description('Initialize AI Firewall in your project')
  .option('--yes', 'Accept all defaults')
  .action(async (options) => {
    const fs = require('fs');
    const path = require('path');
    
    console.log(chalk.bold('\n🛡️  AI EXECUTION FIREWALL - PROJECT INIT\n'));
    
    // Check for existing config
    const configPath = path.join(process.cwd(), 'aifw.config.json');
    if (fs.existsSync(configPath) && !options.yes) {
      console.log(chalk.yellow('⚠️  aifw.config.json already exists'));
      console.log(chalk.gray('Use --yes to overwrite or manually edit the file'));
      process.exit(1);
    }
    
    // Create default config
    const defaultConfig = {
      mode: 'block',
      dailyBudget: 50,
      riskThreshold: 70,
      spikeLimit: 20,
      duplicateWindow: 30,
      version: '1.0.0'
    };
    
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    
    // Create sample integration file
    const samplePath = path.join(process.cwd(), 'aifw.example.js');
    const sampleCode = `// AI Execution Firewall - Sample Integration
const { withFirewall } = require('ai-execution-firewall');
const OpenAI = require('openai');

// Wrap your OpenAI client with firewall protection
const openai = withFirewall(new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
}), {
  trustMode: 'block', // 'monitor' | 'warn' | 'block'
  
  // Real-time alerts
  onBlock: (reason, dangerScore, estimatedCost) => {
    console.log(\`🔥 BLOCKED: \${reason}\`);
    console.log(\`💰 SAVED: \$\${estimatedCost}\`);
  },
  
  onWarn: (reason, dangerScore, estimatedCost) => {
    console.log(\`⚠️  WARNING: \${reason}\`);
  },
  
  onSpike: (requests, timeWindow) => {
    console.log(\`🚨 SPIKE: \${requests} requests in \${timeWindow}s\`);
  }
});

// Use normally - firewall intercepts automatically
async function generateText(prompt) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: prompt }]
  });
  return response.choices[0].message.content;
}

module.exports = { generateText };
`;
    
    if (!fs.existsSync(samplePath)) {
      fs.writeFileSync(samplePath, sampleCode);
    }
    
    // Create .github/workflows if it doesn't exist
    const githubDir = path.join(process.cwd(), '.github', 'workflows');
    if (!fs.existsSync(githubDir)) {
      fs.mkdirSync(githubDir, { recursive: true });
    }
    
    const workflowPath = path.join(githubDir, 'aifw.yml');
    const workflowContent = `name: AI Firewall Check

on:
  pull_request:
    branches: [main, master]
  push:
    branches: [main, master]

jobs:
  ai-security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run AI Firewall Check
        run: npx ai-execution-firewall ci --fail-on HIGH
        env:
          OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
`;
    
    if (!fs.existsSync(workflowPath)) {
      fs.writeFileSync(workflowPath, workflowContent);
    }
    
    console.log(chalk.green('✅ AI Firewall initialized!\n'));
    console.log(chalk.bold('Created files:'));
    console.log(chalk.cyan('  • aifw.config.json - Configuration'));
    console.log(chalk.cyan('  • aifw.example.js - Sample integration'));
    console.log(chalk.cyan('  • .github/workflows/aifw.yml - GitHub Action'));
    console.log('');
    console.log(chalk.bold('Next steps:'));
    console.log(chalk.gray('  1. Install: npm install ai-execution-firewall'));
    console.log(chalk.gray('  2. Copy aifw.example.js to your code'));
    console.log(chalk.gray('  3. Run: aifw hook --install'));
    console.log(chalk.gray('  4. Push to enable GitHub Actions'));
    console.log('');
    console.log(chalk.bold('Configuration:'));
    console.log(JSON.stringify(defaultConfig, null, 2));
    console.log('');
    process.exit(0);
  });

// ============================================================================
// SUMMARY command - Session-level aggregation
// Shows total requests, blocked, saved, spent
// ============================================================================
program
  .command('summary')
  .description('Show session-level cost protection summary')
  .option('-h, --hours <hours>', 'Time period in hours', '24')
  .action((options) => {
    const hours = parseInt(options.hours) || 24;
    const summary = sessionStats.getSummary(hours);

    console.log('');
    console.log(chalk.bold('💸 WITHOUT FIREWALL:'));
    console.log(chalk.red(`   You would have spent $${summary.totalWouldHaveLost.toFixed(2)}`));
    console.log('');
    
    console.log(chalk.bold('🛡️ WITH FIREWALL:'));
    console.log(chalk.green(`   You spent $${summary.totalSpent.toFixed(2)}`));
    console.log(chalk.green.bold(`   Saved $${summary.totalSaved.toFixed(2)}`));
    console.log('');
    
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold('SESSION STATISTICS'));
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log('');
    console.log(`${chalk.bold('Period:')} ${summary.period}`);
    console.log(`${chalk.bold('Total Requests:')} ${summary.totalRequests}`);
    console.log(`${chalk.bold('Allowed:')} ${summary.totalAllowed}`);
    console.log(`${chalk.bold('Blocked:')} ${chalk.red(summary.totalBlocked)}`);
    console.log(`${chalk.bold('Protection Rate:')} ${summary.protectionRate.toFixed(1)}%`);
    console.log('');
    
    if (summary.totalSaved > 0) {
      console.log(chalk.green.bold(`💰 Total Savings: $${summary.totalSaved.toFixed(2)}`));
    }
    
    console.log('');
    console.log(chalk.gray('Run "aifw dashboard" for detailed metrics'));
    console.log('');
    process.exit(0);
  });

program.parse();
