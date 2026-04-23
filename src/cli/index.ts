#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { ProxyServer } from '../proxy';
import { Logger } from '../logger';
import { ConfigManager } from '../config';

const program = new Command();

program
  .name('aispend')
  .description('AI Waste Guard - Prevent wasted AI API usage')
  .version('1.0.0');

program
  .command('start')
  .description('Start the AI Waste Guard proxy server')
  .option('-p, --port <port>', 'Port to run the proxy on')
  .action((options) => {
    console.log(chalk.blue.bold('\n🛡️  AI Waste Guard\n'));
    const server = new ProxyServer(options.port ? parseInt(options.port) : undefined);
    server.start();
  });

program
  .command('report')
  .description('Show usage and savings report')
  .option('-h, --hours <hours>', 'Hours to report on', '24')
  .action((options) => {
    const logger = new Logger();
    const stats = logger.getStats(parseInt(options.hours));
    
    console.log(chalk.blue.bold('\n📊 AI Waste Guard Report\n'));
    console.log(chalk.gray(`Last ${options.hours} hours\n`));
    
    console.log(`${chalk.bold('Total Requests:')} ${stats.totalRequests}`);
    console.log(`${chalk.bold('Blocked Requests:')} ${chalk.red(stats.blockedRequests)}`);
    console.log(`${chalk.bold('Total Cost:')} $${stats.totalCost.toFixed(4)}`);
    console.log(`${chalk.bold('Prevented Cost:')} ${chalk.green('$' + stats.preventedCost.toFixed(4))}`);
    console.log(`${chalk.bold('Total Tokens:')} ${stats.totalTokens.toLocaleString()}`);
    
    if (stats.preventedCost > 0) {
      console.log(chalk.green.bold(`\n💰 You saved $${stats.preventedCost.toFixed(4)} by blocking ${stats.blockedRequests} wasteful requests!`));
    }
    
    console.log('');
  });

program
  .command('config')
  .description('View or update configuration')
  .option('--block-mode <true|false>', 'Enable/disable block mode')
  .option('--max-cost <amount>', 'Maximum cost per request')
  .option('--waste-threshold <percentage>', 'Waste threshold percentage')
  .option('--reset', 'Reset to default configuration')
  .action((options) => {
    const config = new ConfigManager();
    const currentConfig = config.getConfig();
    
    if (options.reset) {
      config.resetConfig();
      console.log(chalk.green('Configuration reset to defaults'));
      return;
    }
    
    if (options.blockMode !== undefined) {
      config.updateConfig({ blockMode: options.blockMode === 'true' });
    }
    
    if (options.maxCost !== undefined) {
      config.updateConfig({ maxCostPerRequest: parseFloat(options.maxCost) });
    }
    
    if (options.wasteThreshold !== undefined) {
      config.updateConfig({ wasteThreshold: parseInt(options.wasteThreshold) });
    }
    
    console.log(chalk.blue.bold('\n⚙️  Configuration\n'));
    console.log(`${chalk.bold('Block Mode:')} ${currentConfig.blockMode ? chalk.green('ON') : chalk.red('OFF')}`);
    console.log(`${chalk.bold('Max Cost Per Request:')} $${currentConfig.maxCostPerRequest.toFixed(2)}`);
    console.log(`${chalk.bold('Waste Threshold:')} ${currentConfig.wasteThreshold}%`);
    console.log(`${chalk.bold('Allow Override:')} ${currentConfig.allowOverride ? 'Yes' : 'No'}`);
    console.log(`${chalk.bold('Proxy Port:')} ${currentConfig.proxyPort}`);
    console.log('');
  });

program
  .command('blocked')
  .description('Show recently blocked requests')
  .option('-n, --number <count>', 'Number of requests to show', '10')
  .action((options) => {
    const logger = new Logger();
    const blocked = logger.getBlockedRequests(parseInt(options.number));
    
    console.log(chalk.blue.bold('\n🚫 Recently Blocked Requests\n'));
    
    if (blocked.length === 0) {
      console.log(chalk.gray('No blocked requests found'));
    } else {
      blocked.forEach((req, i) => {
        const date = new Date(req.timestamp).toLocaleString();
        console.log(chalk.bold(`${i + 1}. ${req.model} - ${date}`));
        console.log(chalk.red(`   Reason: ${req.reason || 'Unknown'}`));
        console.log(chalk.gray(`   Waste Score: ${req.wasteScore}% | Cost: $${req.estimatedCost.toFixed(4)}\n`));
      });
    }
    
    console.log('');
  });

program.parse();
