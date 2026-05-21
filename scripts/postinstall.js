#!/usr/bin/env node

/**
 * Postinstall script for AI Execution Firewall
 * Automatically detects project type and sets up configuration
 */

const fs = require('fs');
const path = require('path');

const ANSI = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function log(message, color = 'reset') {
  console.log(`${ANSI[color]}${message}${ANSI.reset}`);
}

function detectProjectType() {
  const cwd = process.cwd();
  
  // Check for Next.js
  if (fs.existsSync(path.join(cwd, 'next.config.js')) || 
      fs.existsSync(path.join(cwd, 'next.config.mjs')) ||
      fs.existsSync(path.join(cwd, 'next.config.ts'))) {
    const packageJson = readPackageJson();
    if (packageJson?.dependencies?.next) {
      return 'nextjs';
    }
  }
  
  // Check for Express
  if (fs.existsSync(path.join(cwd, 'src', 'server.ts')) ||
      fs.existsSync(path.join(cwd, 'server.js')) ||
      fs.existsSync(path.join(cwd, 'app.js'))) {
    const packageJson = readPackageJson();
    if (packageJson?.dependencies?.express) {
      return 'express';
    }
  }
  
  // Check for generic Node.js
  if (fs.existsSync(path.join(cwd, 'package.json'))) {
    return 'nodejs';
  }
  
  return 'unknown';
}

function readPackageJson() {
  try {
    const packagePath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(packagePath)) {
      return JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    }
  } catch (e) {
    return null;
  }
  return null;
}

function createConfigFile() {
  const configPath = path.join(process.cwd(), 'aifw.config.json');
  
  if (fs.existsSync(configPath)) {
    log('✓ aifw.config.json already exists', 'green');
    return false;
  }
  
  const defaultConfig = {
    defaultMode: 'block',
    riskThreshold: 50,
    budgetPerDay: 50,
    logging: true,
    maxCost: 5,
    spikeLimit: 20,
    duplicateWindow: 30,
    version: '1.0.0'
  };
  
  fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
  log('✓ Created aifw.config.json', 'green');
  return true;
}

function createExampleFile(projectType) {
  const examplePath = path.join(process.cwd(), 'aifw.example.js');
  
  if (fs.existsSync(examplePath)) {
    return;
  }
  
  let exampleCode = '';
  
  if (projectType === 'nextjs') {
    exampleCode = `// AI Execution Firewall - Next.js Example
// Copy this to your lib/openai.ts or utils/openai.ts

import OpenAI from 'openai';
import { guard } from '@salimassili/ai-costguard';

export const openai = guard(
  new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  {
    trustMode: 'block',
    dailyBudget: 50,
    maxCost: 5,
    
    onBlock: (reason, dangerScore, estimatedCost) => {
      console.error('🔥 BLOCKED:', reason);
      console.error('   SAVED: $', estimatedCost);
    },
    
    onWarn: (reason, dangerScore, estimatedCost) => {
      console.warn('⚠️ WARNING:', reason);
    },
  }
);
`;
  } else if (projectType === 'express') {
    exampleCode = `// AI Execution Firewall - Express Example
// Add this to your server.ts or app.js

import express from 'express';
import { expressFirewall } from 'ai-execution-firewall';

const app = express();

// Global firewall middleware
app.use(expressFirewall({
  trustMode: 'block',
  dailyBudget: 50,
  maxCost: 5,
  
  onBlock: (req, res, reason, details) => {
    res.status(403).json({
      error: 'Blocked by AI Firewall',
      saved: details.estimatedCost,
    });
  },
}));
`;
  } else {
    exampleCode = `// AI Execution Firewall - Node.js Example

import { guard } from '@salimassili/ai-costguard';
import OpenAI from 'openai';

const openai = guard(
  new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  {
    trustMode: 'block',
    dailyBudget: 50,
    maxCost: 5,
  }
);

// Use normally
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello' }],
});
`;
  }
  
  fs.writeFileSync(examplePath, exampleCode);
  log(`✓ Created aifw.example.js (${projectType} template)`, 'green');
}

function addScriptsToPackageJson() {
  const packagePath = path.join(process.cwd(), 'package.json');
  
  try {
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    
    if (!packageJson.scripts) {
      packageJson.scripts = {};
    }
    
    const scriptsToAdd = {
      'ai:check': 'aifw check',
      'ai:dashboard': 'aifw dashboard',
      'ai:budget': 'aifw budget',
      'ai:report': 'aifw report'
    };
    
    let added = false;
    for (const [name, command] of Object.entries(scriptsToAdd)) {
      if (!packageJson.scripts[name]) {
        packageJson.scripts[name] = command;
        added = true;
      }
    }
    
    if (added) {
      fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
      log('✓ Added npm scripts (ai:check, ai:dashboard, ai:budget, ai:report)', 'green');
    }
  } catch (e) {
    log('⚠ Could not update package.json', 'yellow');
  }
}

function printNextSteps(projectType) {
  console.log('');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');
  log('🛡️  AI Execution Firewall Setup Complete', 'bright');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');
  console.log('');
  
  if (projectType === 'nextjs') {
    log('Next Steps for Next.js:', 'bright');
    console.log('  1. Copy aifw.example.js to src/lib/openai.ts');
    console.log('  2. Import the protected client in your API routes');
    console.log('  3. Use npm run ai:dashboard to monitor costs');
  } else if (projectType === 'express') {
    log('Next Steps for Express:', 'bright');
    console.log('  1. Add expressFirewall middleware to your app');
    console.log('  2. See aifw.example.js for code snippet');
    console.log('  3. Use npm run ai:dashboard to monitor costs');
  } else {
    log('Next Steps:', 'bright');
    console.log('  1. See aifw.example.js for integration example');
    console.log('  2. Run aifw init for full setup');
    console.log('  3. Use npm run ai:dashboard to monitor costs');
  }
  
  console.log('');
  log('Configuration file: aifw.config.json', 'cyan');
  log('Run: aifw dashboard', 'cyan');
  console.log('');
}

// Main
function main() {
  console.log('');
  log('🔧 AI Execution Firewall - Postinstall Setup', 'bright');
  console.log('');
  
  // Detect if we're installing as a dependency
  const isDependencyInstall = process.env.INIT_CWD && process.env.INIT_CWD !== process.cwd();
  
  if (isDependencyInstall) {
    // Don't run automatic setup when installed as dependency
    // User should run 'aifw init' manually
    console.log('AI Execution Firewall installed.');
    console.log('Run "npx aifw init" to set up your project.');
    console.log('');
    return;
  }
  
  const projectType = detectProjectType();
  
  if (projectType === 'unknown') {
    log('⚠ Unknown project type', 'yellow');
    log('Run "npx aifw init" manually to set up', 'yellow');
    return;
  }
  
  log(`✓ Detected: ${projectType}`, 'green');
  
  createConfigFile();
  createExampleFile(projectType);
  addScriptsToPackageJson();
  
  printNextSteps(projectType);
}

main();
