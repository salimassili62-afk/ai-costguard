import chalk from 'chalk';

/**
 * Real-time CLI alert formatter
 * Provides formatted, urgent alerts for firewall events
 */

export interface AlertData {
  severity: 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  category: 'loop' | 'duplicate' | 'fuzzy_duplicate' | 'context' | 'spike' | 'anomaly';
  reason: string;
  estimatedLoss: number;
  suggestions: string[];
}

export function formatAlert(data: AlertData): string {
  const { severity, category, reason, estimatedLoss, suggestions } = data;
  
  let output = '\n';
  
  // Alert header
  if (severity === 'SAFE') {
    return ''; // Don't show alert for safe requests
  } else if (severity === 'CRITICAL') {
    output += chalk.red.bold('🚨 FIREWALL ALERT - CRITICAL\n');
  } else if (severity === 'HIGH') {
    output += chalk.red.bold('⚠️  FIREWALL ALERT - HIGH\n');
  } else if (severity === 'MEDIUM') {
    output += chalk.yellow.bold('⚠️  FIREWALL ALERT - MEDIUM\n');
  } else {
    output += chalk.blue.bold('ℹ️  FIREWALL ALERT - LOW\n');
  }
  
  // Category badge
  const categoryColors: Record<string, any> = {
    loop: chalk.red,
    duplicate: chalk.yellow,
    fuzzy_duplicate: chalk.yellow,
    context: chalk.magenta,
    spike: chalk.red,
    anomaly: chalk.blue,
  };
  
  output += `${categoryColors[category] || chalk.white}Category: ${category.toUpperCase()}\n`;
  output += chalk.white(`Reason: ${reason}\n`);
  output += chalk.yellow(`💸 Potential loss: $${estimatedLoss.toFixed(4)}\n`);
  
  // Suggestions
  if (suggestions.length > 0) {
    output += chalk.cyan('\nSuggestions:\n');
    suggestions.forEach((s, i) => {
      output += chalk.cyan(`  ${i + 1}. ${s}\n`);
    });
  }
  
  output += '\n';
  return output;
}

export function formatSessionReport(stats: {
  totalRequests: number;
  blockedRequests: number;
  warnedRequests: number;
  totalCost: number;
  preventedCost: number;
  duration: number; // in seconds
}): string {
  const { totalRequests, blockedRequests, warnedRequests, totalCost, preventedCost, duration } = stats;
  
  let output = '\n';
  output += chalk.bold.blue('📊 SESSION REPORT\n');
  output += chalk.gray('─'.repeat(40) + '\n');
  output += chalk.white(`Total Requests: ${chalk.cyan(totalRequests)}\n`);
  output += chalk.red(`Blocked: ${chalk.bold(blockedRequests)}\n`);
  output += chalk.yellow(`Warnings: ${chalk.bold(warnedRequests)}\n`);
  output += chalk.white(`Total Cost: ${chalk.green(`$${totalCost.toFixed(4)}`)}\n`);
  output += chalk.green(`Loss Prevented: ${chalk.bold(`$${preventedCost.toFixed(4)}`)}\n`);
  output += chalk.gray(`Duration: ${Math.floor(duration / 60)}m ${duration % 60}s\n`);
  output += '\n';
  
  return output;
}
