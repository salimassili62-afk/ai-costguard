/**
 * publicDemoPage.ts - Screenshot-Friendly Demo Output
 * 
 * Generates HTML/JSON for demo pages showing:
 * - Cost before firewall
 * - Cost after firewall
 * - Savings amount
 * - Blocked events timeline
 * 
 * Must be visually compelling for screenshots and sharing.
 */

import { DemoSession, DemoScenario, DemoStep, DemoSummary } from './demoLinkGenerator';

export interface DemoPageOptions {
  title: string;
  scenarios?: DemoScenario[];
  session?: DemoSession;
  baseUrl: string;
  shareable?: boolean;
  minimal?: boolean;
}

export interface DemoJSON {
  title: string;
  description: string;
  summary: {
    totalRequests: number;
    blocked: number;
    allowed: number;
    costBefore: string;
    costAfter: string;
    savings: string;
    savingsPercent: string;
  };
  scenario: {
    name: string;
    description: string;
    model: string;
  };
  timeline: Array<{
    step: number;
    decision: string;
    cost: string;
    saved: string;
    reason: string;
  }>;
  shareUrl?: string;
}

/**
 * Generate HTML demo page
 * Screenshot-friendly, visually compelling
 */
export function generateDemoHTML(options: DemoPageOptions): string {
  if (options.session) {
    return generateSessionPage(options);
  } else {
    return generateScenarioListPage(options);
  }
}

/**
 * Generate JSON representation of demo
 * For API consumers and programmatic access
 */
export function generateDemoJSON(session: DemoSession): DemoJSON {
  const s = session.summary;

  return {
    title: session.title,
    description: session.description,
    summary: {
      totalRequests: s.totalRequests,
      blocked: s.blocked,
      allowed: s.allowed,
      costBefore: formatCurrency(s.totalCostBefore),
      costAfter: formatCurrency(s.totalCostAfter),
      savings: formatCurrency(s.totalSaved),
      savingsPercent: `${s.savingsPercent.toFixed(1)}%`,
    },
    scenario: {
      name: session.scenario.name,
      description: session.scenario.description,
      model: session.scenario.model,
    },
    timeline: session.steps.slice(0, 20).map(step => ({
      step: step.stepNumber,
      decision: step.decision.toUpperCase(),
      cost: formatCurrency(step.estimatedCost),
      saved: formatCurrency(step.saved),
      reason: step.decisionReason,
    })),
  };
}

// Private HTML generators

function generateSessionPage(options: DemoPageOptions): string {
  const session = options.session!;
  const s = session.summary;
  const shareUrl = options.shareable 
    ? `${options.baseUrl}/share/${session.id}`
    : null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(options.title)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 40px 20px;
      color: #333;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
    }
    .header {
      text-align: center;
      margin-bottom: 40px;
      color: white;
    }
    .header h1 {
      font-size: 2.5rem;
      margin-bottom: 10px;
      text-shadow: 0 2px 4px rgba(0,0,0,0.3);
    }
    .header p {
      font-size: 1.2rem;
      opacity: 0.9;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 32px;
      margin-bottom: 24px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 24px;
      margin-bottom: 32px;
    }
    .stat-box {
      text-align: center;
      padding: 24px;
      border-radius: 12px;
      background: #f8f9fa;
    }
    .stat-box.negative {
      background: #fee;
    }
    .stat-box.positive {
      background: #efe;
    }
    .stat-box.highlight {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .stat-value {
      font-size: 2rem;
      font-weight: bold;
      margin-bottom: 8px;
    }
    .stat-label {
      font-size: 0.9rem;
      color: #666;
    }
    .stat-box.highlight .stat-label {
      color: rgba(255,255,255,0.8);
    }
    .section-title {
      font-size: 1.3rem;
      font-weight: 600;
      margin-bottom: 20px;
      color: #333;
    }
    .scenario-info {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .scenario-info h3 {
      margin-bottom: 8px;
      color: #667eea;
    }
    .timeline {
      max-height: 400px;
      overflow-y: auto;
    }
    .timeline-item {
      display: flex;
      align-items: center;
      padding: 12px;
      border-bottom: 1px solid #eee;
    }
    .timeline-item:last-child {
      border-bottom: none;
    }
    .decision-badge {
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      margin-right: 16px;
      min-width: 80px;
      text-align: center;
    }
    .decision-badge.allow {
      background: #d4edda;
      color: #155724;
    }
    .decision-badge.block {
      background: #f8d7da;
      color: #721c24;
    }
    .decision-badge.throttle {
      background: #fff3cd;
      color: #856404;
    }
    .step-info {
      flex: 1;
    }
    .step-cost {
      text-align: right;
      font-family: monospace;
    }
    .savings {
      color: #28a745;
      font-weight: 600;
    }
    .cost {
      color: #dc3545;
    }
    .share-section {
      text-align: center;
      margin-top: 32px;
      padding-top: 32px;
      border-top: 2px solid #eee;
    }
    .share-url {
      background: #f8f9fa;
      padding: 16px;
      border-radius: 8px;
      font-family: monospace;
      margin: 16px 0;
      word-break: break-all;
    }
    .btn {
      display: inline-block;
      padding: 12px 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      margin: 8px;
      border: none;
      cursor: pointer;
    }
    .btn:hover {
      opacity: 0.9;
    }
    .tag {
      display: inline-block;
      padding: 4px 12px;
      background: #e9ecef;
      border-radius: 20px;
      font-size: 0.8rem;
      margin: 4px;
    }
    @media (max-width: 600px) {
      .header h1 { font-size: 1.8rem; }
      .card { padding: 20px; }
      .stat-value { font-size: 1.5rem; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🛡️ AI Cost Explosion Prevention</h1>
      <p>See how much you could save in production</p>
    </div>

    <div class="card">
      <div class="stats-grid">
        <div class="stat-box negative">
          <div class="stat-value cost">${formatCurrency(s.totalCostBefore)}</div>
          <div class="stat-label">Cost Without Protection</div>
        </div>
        <div class="stat-box positive">
          <div class="stat-value">${formatCurrency(s.totalCostAfter)}</div>
          <div class="stat-label">Cost With Firewall</div>
        </div>
        <div class="stat-box highlight">
          <div class="stat-value savings">${formatCurrency(s.totalSaved)}</div>
          <div class="stat-label">Money Saved (${s.savingsPercent.toFixed(1)}%)</div>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-value">${s.totalRequests}</div>
          <div class="stat-label">Total Requests</div>
        </div>
        <div class="stat-box">
          <div class="stat-value" style="color: #dc3545;">${s.blocked}</div>
          <div class="stat-label">Blocked (Cost Saved)</div>
        </div>
        <div class="stat-box">
          <div class="stat-value" style="color: #856404;">${s.throttled}</div>
          <div class="stat-label">Throttled</div>
        </div>
        <div class="stat-box">
          <div class="stat-value" style="color: #28a745;">${s.allowed}</div>
          <div class="stat-label">Allowed</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="scenario-info">
        <h3>📋 ${escapeHtml(session.scenario.name)}</h3>
        <p>${escapeHtml(session.scenario.description)}</p>
        <p><strong>Model:</strong> ${escapeHtml(session.scenario.model)}</p>
      </div>
    </div>

    <div class="card">
      <h2 class="section-title">🎬 Execution Timeline</h2>
      <div class="timeline">
        ${generateTimelineHTML(session.steps)}
      </div>
    </div>

    ${shareUrl ? `
    <div class="card">
      <div class="share-section">
        <h2 class="section-title">🔗 Share This Demo</h2>
        <div class="share-url">${escapeHtml(shareUrl)}</div>
        <a href="${escapeHtml(shareUrl)}" class="btn">Open Share Link</a>
        <button class="btn" onclick="copyToClipboard()">Copy Link</button>
      </div>
    </div>
    ` : ''}
  </div>

  <script>
    function copyToClipboard() {
      const url = '${shareUrl || ''}';
      navigator.clipboard.writeText(url).then(() => {
        alert('Link copied to clipboard!');
      });
    }
  </script>
</body>
</html>`;
}

function generateScenarioListPage(options: DemoPageOptions): string {
  const scenarios = options.scenarios || [];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(options.title)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 40px 20px;
      color: #333;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
    }
    .header {
      text-align: center;
      margin-bottom: 40px;
      color: white;
    }
    .header h1 {
      font-size: 2.5rem;
      margin-bottom: 10px;
      text-shadow: 0 2px 4px rgba(0,0,0,0.3);
    }
    .header p {
      font-size: 1.2rem;
      opacity: 0.9;
      margin-bottom: 20px;
    }
    .subtitle {
      font-size: 1.1rem;
      max-width: 600px;
      margin: 0 auto;
      opacity: 0.85;
      line-height: 1.6;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 32px;
      margin-bottom: 24px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
    }
    .scenario-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 24px;
    }
    .scenario-card {
      background: #f8f9fa;
      border-radius: 12px;
      padding: 24px;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
      text-decoration: none;
      color: inherit;
      display: block;
    }
    .scenario-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
    }
    .scenario-icon {
      font-size: 2rem;
      margin-bottom: 12px;
    }
    .scenario-card h3 {
      color: #667eea;
      margin-bottom: 8px;
      font-size: 1.2rem;
    }
    .scenario-card p {
      color: #666;
      font-size: 0.95rem;
      line-height: 1.5;
      margin-bottom: 12px;
    }
    .scenario-meta {
      display: flex;
      gap: 16px;
      font-size: 0.85rem;
      color: #888;
    }
    .btn {
      display: inline-block;
      padding: 16px 32px;
      background: white;
      color: #667eea;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 1.1rem;
      margin-top: 20px;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }
    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(0,0,0,0.25);
    }
    @media (max-width: 600px) {
      .header h1 { font-size: 1.8rem; }
      .card { padding: 20px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🛡️ Stop OpenAI Agent Cost Explosions</h1>
      <p>Interactive demos showing real cost savings</p>
      <p class="subtitle">
        See how the AI Cost Explosion Prevention Layer stops runaway agents, 
        uncontrolled API spending, and production LLM cost spikes before they happen.
      </p>
      <a href="https://github.com/your-repo/ai-firewall" class="btn">Install on GitHub</a>
    </div>

    <div class="card">
      <h2 style="margin-bottom: 24px; text-align: center;">Choose a Demo Scenario</h2>
      <div class="scenario-grid">
        ${scenarios.map(s => `
          <a href="/api/demo/create?scenario=${encodeURIComponent(s.name)}" class="scenario-card">
            <div class="scenario-icon">${getScenarioIcon(s.agentType)}</div>
            <h3>${escapeHtml(s.name)}</h3>
            <p>${escapeHtml(s.description)}</p>
            <div class="scenario-meta">
              <span>${s.requestCount} requests</span>
              <span>${escapeHtml(s.model)}</span>
            </div>
          </a>
        `).join('')}
      </div>
    </div>

    <div class="card" style="text-align: center;">
      <h3 style="margin-bottom: 16px;">💡 How It Works</h3>
      <p style="color: #666; line-height: 1.6; max-width: 600px; margin: 0 auto;">
        The AI Cost Explosion Prevention Layer monitors your OpenAI API calls in real-time,
        detecting and blocking expensive runaway patterns before they drain your budget.
        Every blocked request saves you money—see the results in real-time.
      </p>
    </div>
  </div>
</body>
</html>`;
}

// Helper functions

function generateTimelineHTML(steps: DemoStep[]): string {
  return steps.slice(0, 15).map(step => `
    <div class="timeline-item">
      <span class="decision-badge ${step.decision}">${step.decision}</span>
      <div class="step-info">
        <div>Step ${step.stepNumber}: ${escapeHtml(step.request.substring(0, 50))}${step.request.length > 50 ? '...' : ''}</div>
        <small style="color: #888;">${escapeHtml(step.decisionReason)}</small>
      </div>
      <div class="step-cost">
        <div class="cost">${formatCurrency(step.estimatedCost)}</div>
        ${step.saved > 0 ? `<div class="savings">-${formatCurrency(step.saved)}</div>` : ''}
      </div>
    </div>
  `).join('') + (steps.length > 15 ? `
    <div class="timeline-item" style="justify-content: center; color: #888;">
      ... and ${steps.length - 15} more steps
    </div>
  ` : '');
}

function getScenarioIcon(agentType: string): string {
  const icons: Record<string, string> = {
    chatbot: '💬',
    code: '💻',
    research: '🔍',
    automation: '⚙️',
  };
  return icons[agentType] || '🤖';
}

function formatCurrency(amount: number): string {
  return '$' + amount.toFixed(2);
}

function escapeHtml(text: string): string {
  const div = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return text.replace(/[&<>"']/g, c => div[c as keyof typeof div] || c);
}

// Convenience exports
export { formatCurrency, escapeHtml };
