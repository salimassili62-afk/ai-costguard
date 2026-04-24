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
