#!/usr/bin/env node

import { Command } from 'commander';
import { runDemo, formatDemoOutput } from '../demo/demoRunner';
import { toRoiDashboard, formatRoiDashboardHuman } from '../dashboard/roiDashboard';
import { compareWithGuard } from '../demo/compareExecution';
import { ConfigServer } from '../controlPlane/configServer';

/**
 * This product is valuable only if users can SEE money saved instantly.
 */
const program = new Command();
program
  .name('ai-firewall')
  .description('A pre-execution firewall that shows and stops AI cost explosions in real time.')
  .version('1.1.3');

program
  .command('demo')
  .description('Run screenshot-ready ROI demo')
  .action(() => {
    const result = runDemo();
    console.log(formatDemoOutput(result));
    console.log('\nROI SUMMARY JSON');
    console.log('----------------');
    console.log(JSON.stringify(toRoiDashboard(result), null, 2));
  });

program
  .command('dashboard')
  .description('Print ROI dashboard output')
  .option('--json', 'Output JSON only')
  .action(options => {
    const result = runDemo();
    const dashboard = toRoiDashboard(result);
    if (options.json) {
      console.log(JSON.stringify(dashboard, null, 2));
      return;
    }
    console.log(formatRoiDashboardHuman(dashboard));
  });

program
  .command('compare')
  .description('Show before vs after firewall comparison')
  .action(() => {
    const comparison = compareWithGuard([0.12, 0.18, 0.31, 0.44, 0.52]);
    console.log('BEFORE / AFTER COMPARISON');
    console.log('=========================');
    console.log(`COST WITHOUT FIREWALL: $${comparison.costWithoutFirewall.toFixed(2)}`);
    console.log(`COST WITH FIREWALL:    $${comparison.costWithFirewall.toFixed(2)}`);
    console.log(`LOOPS DETECTED: ${comparison.loopsDetected}`);
    console.log(`SAVINGS DIFFERENCE: $${comparison.savingsDifference.toFixed(2)}`);
  });

program
  .command('control-plane')
  .description('Run control-plane v0 server')
  .option('-p, --port <port>', 'Port number', '3001')
  .action(options => {
    const port = parseInt(options.port, 10);
    const server = new ConfigServer();
    server.listen(port);
    console.log(`Control plane listening on http://localhost:${port}`);
    console.log(`GET /dashboard | POST /config/update | GET /config/:key`);
  });

program.parse();
