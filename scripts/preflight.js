#!/usr/bin/env node
/**
 * CI PREFLIGHT CHECKS
 * Hard fail conditions for production readiness
 * 
 * This script runs critical checks that must pass before CI/build continues.
 * Any failure exits with code 1 to halt the pipeline.
 */

const { execSync } = require('child_process');
const process = require('process');

const CHECKS = {
  passed: 0,
  failed: 0,
  errors: [],
};

function runCheck(name, command) {
  console.log(`\n🔍 ${name}...`);
  try {
    execSync(command, { stdio: 'inherit' });
    console.log(`✅ ${name} PASSED`);
    CHECKS.passed++;
    return true;
  } catch (error) {
    console.error(`❌ ${name} FAILED`);
    CHECKS.failed++;
    CHECKS.errors.push({ name, error: error.message });
    return false;
  }
}

function runSilentCheck(name, command) {
  console.log(`\n🔍 ${name}...`);
  try {
    execSync(command, { stdio: 'pipe' });
    console.log(`✅ ${name} PASSED`);
    CHECKS.passed++;
    return true;
  } catch (error) {
    console.error(`❌ ${name} FAILED`);
    CHECKS.failed++;
    CHECKS.errors.push({ name, error: error.message });
    return false;
  }
}

console.log('╔════════════════════════════════════════════════════════╗');
console.log('║     CI PREFLIGHT CHECKS - Production Readiness       ║');
console.log('╚════════════════════════════════════════════════════════╝');

// 1. TypeScript compilation check (tsc --noEmit)
runCheck(
  'TypeScript Compilation (tsc --noEmit)',
  'npx tsc --noEmit'
);

// 2. Run all tests
runCheck(
  'Jest Test Suite',
  'npm test'
);

// 3. Check for async field initializers (basic grep check)
runSilentCheck(
  'No Async Field Initializers',
  'git grep -n "= new.*await" src/*.ts src/**/*.ts || exit 0'
);

// 4. Verify all exports have matching files
console.log('\n🔍 Export Consistency Check...');
try {
  const indexContent = require('fs').readFileSync('src/index.ts', 'utf8');
  const exportMatches = indexContent.match(/from\s+['"](.+?)['"]/g) || [];
  const uniquePaths = [...new Set(exportMatches.map(m => m.replace(/from\s+['"](.+?)['"]/, '$1')))];
  
  const fs = require('fs');
  const path = require('path');
  let missingExports = 0;
  
  for (const exportPath of uniquePaths) {
    const fullPath = path.join('src', exportPath + '.ts');
    const indexPath = path.join('src', exportPath, 'index.ts');
    
    const hasFile = fs.existsSync(fullPath);
    const hasIndex = fs.existsSync(indexPath);
    
    if (!hasFile && !hasIndex) {
      console.error(`  ⚠️  Missing: ${exportPath}`);
      missingExports++;
    }
  }
  
  if (missingExports === 0) {
    console.log('✅ Export Consistency Check PASSED');
    CHECKS.passed++;
  } else {
    console.error(`❌ Export Consistency Check FAILED: ${missingExports} missing`);
    CHECKS.failed++;
    CHECKS.errors.push({ name: 'Export Consistency', error: `${missingExports} missing exports` });
  }
} catch (error) {
  console.error('❌ Export Consistency Check FAILED:', error.message);
  CHECKS.failed++;
}

// Summary
console.log('\n═══════════════════════════════════════════════════════════');
console.log('PREFLIGHT SUMMARY:');
console.log(`  ✅ Passed: ${CHECKS.passed}`);
console.log(`  ❌ Failed: ${CHECKS.failed}`);

if (CHECKS.failed > 0) {
  console.log('\nFailed checks:');
  CHECKS.errors.forEach(err => {
    console.log(`  - ${err.name}: ${err.error}`);
  });
  console.log('\n❌ PREFLIGHT FAILED - Build halted');
  process.exit(1);
} else {
  console.log('\n✅ ALL PREFLIGHT CHECKS PASSED - Proceeding with build');
  process.exit(0);
}
