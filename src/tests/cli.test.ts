/**
 * Integration tests for CLI commands
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('CLI Commands', () => {
  test('check command should validate safety and show output', async () => {
    const { stdout, stderr } = await execAsync('node dist/cli/index.js check "test prompt" --model gpt-4');
    expect(stdout).toContain('AI EXECUTION FIREWALL');
    expect(stdout).toContain('Model:');
    expect(stdout).toContain('Tokens:');
    expect(stdout).toContain('Estimated Cost:');
  });

  test('check command should detect empty prompt as dangerous', async () => {
    const { stdout } = await execAsync('node dist/cli/index.js check "" --model gpt-4');
    expect(stdout).toContain('Invalid prompt');
    expect(stdout).toContain('KILL SWITCH TRIGGERED');
  });

  test('report command should show statistics', async () => {
    const { stdout } = await execAsync('node dist/cli/index.js report');
    expect(stdout).toContain('FIREWALL PROTECTION REPORT');
    expect(stdout).toContain('Total Requests:');
    expect(stdout).toContain('Blocked Requests:');
  });

  test('blocked command should show block log', async () => {
    const { stdout } = await execAsync('node dist/cli/index.js blocked');
    expect(stdout).toContain('FIREWALL BLOCK LOG');
  });
});
