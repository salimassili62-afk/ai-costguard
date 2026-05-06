/**
 * DocsPage.ts - Technical API Reference
 * 
 * Stripe-style documentation:
 * - Zero marketing language
 * - Pure technical truth
 * - Executable examples
 * - No sales copy
 */

export function generateDocsPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Cost Guard - API Reference</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      background: #0f172a;
      color: #e2e8f0;
      line-height: 1.6;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    header {
      border-bottom: 1px solid #334155;
      padding-bottom: 24px;
      margin-bottom: 40px;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .version {
      font-family: monospace;
      font-size: 0.875rem;
      color: #64748b;
    }
    .intro {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 40px;
    }
    .intro p {
      color: #94a3b8;
      margin-bottom: 16px;
    }
    .intro code {
      background: #0f172a;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.875rem;
    }
    h2 {
      font-size: 1.25rem;
      font-weight: 600;
      margin: 40px 0 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid #334155;
    }
    h3 {
      font-size: 1rem;
      font-weight: 600;
      margin: 32px 0 16px;
      color: #f8fafc;
    }
    .endpoint {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      margin-bottom: 24px;
      overflow: hidden;
    }
    .endpoint-header {
      background: #0f172a;
      padding: 16px 20px;
      border-bottom: 1px solid #334155;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .method {
      font-family: monospace;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 4px 8px;
      border-radius: 4px;
      text-transform: uppercase;
    }
    .method.post { background: #22c55e20; color: #22c55e; }
    .method.get { background: #3b82f620; color: #3b82f6; }
    .path {
      font-family: monospace;
      font-size: 0.875rem;
      color: #f8fafc;
    }
    .endpoint-content {
      padding: 20px;
    }
    .endpoint-content p {
      color: #94a3b8;
      margin-bottom: 16px;
      font-size: 0.875rem;
    }
    .params-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      font-size: 0.875rem;
    }
    .params-table th {
      text-align: left;
      padding: 12px;
      border-bottom: 1px solid #334155;
      color: #64748b;
      font-weight: 500;
    }
    .params-table td {
      padding: 12px;
      border-bottom: 1px solid #334155;
      color: #e2e8f0;
    }
    .params-table td:first-child {
      font-family: monospace;
      color: #f8fafc;
    }
    .type {
      color: #64748b;
      font-size: 0.75rem;
    }
    .required {
      color: #22c55e;
      font-size: 0.75rem;
    }
    pre {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 16px;
      overflow-x: auto;
      font-size: 0.875rem;
      color: #e2e8f0;
    }
    .code-block {
      margin-bottom: 16px;
    }
    .response {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 16px;
      font-family: monospace;
      font-size: 0.875rem;
      color: #22c55e;
    }
    .error-code {
      background: #ef444420;
      color: #ef4444;
    }
    .section-divider {
      border-top: 1px solid #334155;
      margin: 40px 0;
    }
    footer {
      margin-top: 60px;
      padding-top: 24px;
      border-top: 1px solid #334155;
      font-size: 0.75rem;
      color: #64748b;
    }
    footer a {
      color: #64748b;
      text-decoration: none;
      margin-right: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>API Reference</h1>
      <div class="version">v2.0.0 | Base URL: https://ai-costguard.com/api</div>
    </header>

    <div class="intro">
      <p>AI Cost Guard provides infrastructure-layer cost protection for AI API calls. All requests must be authenticated via HMAC-signed API keys.</p>
      <p>Install: <code>npm install ai-costguard</code> | Node.js 18+ required</p>
    </div>

    <h2>Authentication</h2>
    
    <p style="color: #94a3b8; margin-bottom: 20px;">
      Every API request must include a signed authorization header. 
      Requests without valid signatures are rejected at the trust boundary.
    </p>

    <div class="code-block">
      <pre>// Generate signed request
const signature = crypto
  .createHmac('sha256', API_SECRET)
  .update(\`\${apiKey}:\${timestamp}:\${bodyHash}\`)
  .digest('hex');

// Headers required:
Authorization: Bearer {apiKey}
X-Signature: {signature}
X-Timestamp: {unixTimestampMs}
X-Idempotency-Key: {uniqueKey}</pre>
    </div>

    <h2>Protection</h2>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method post">POST</span>
        <span class="path">/v2/protection/intercept</span>
      </div>
      <div class="endpoint-content">
        <p>Intercepts and evaluates an AI API request for cost explosion risk. Returns decision within 50ms.</p>
        
        <table class="params-table">
          <tr>
            <th>Parameter</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
          <tr>
            <td>requestId <span class="required">required</span></td>
            <td class="type">string</td>
            <td>Unique identifier for the request</td>
          </tr>
          <tr>
            <td>model <span class="required">required</span></td>
            <td class="type">string</td>
            <td>Target model (gpt-4, gpt-4o, etc.)</td>
          </tr>
          <tr>
            <td>estimatedTokens <span class="required">required</span></td>
            <td class="type">integer</td>
            <td>Estimated token count for cost calc</td>
          </tr>
          <tr>
            <td>context</td>
            <td class="type">string</td>
            <td>Request context for pattern detection</td>
          </tr>
        </table>

        <div class="code-block">
          <pre>// Request
POST /v2/protection/intercept
{
  "requestId": "req_abc123",
  "model": "gpt-4",
  "estimatedTokens": 2048,
  "context": "customer-service-chat"
}</pre>
        </div>

        <div class="response">
// Response (allow)
{
  "decision": "allow",
  "requestId": "req_abc123",
  "riskScore": 12,
  "estimatedCost": 0.06,
  "latencyMs": 45
}

// Response (block)
{
  "decision": "block",
  "requestId": "req_abc123",
  "riskScore": 95,
  "reason": "Loop pattern detected",
  "moneySaved": 0.06,
  "latencyMs": 48
}</div>
      </div>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method post">POST</span>
        <span class="path">/v2/protection/batch</span>
      </div>
      <div class="endpoint-content">
        <p>Evaluates multiple requests in a single call. Maximum 100 requests per batch.</p>
        
        <div class="code-block">
          <pre>POST /v2/protection/batch
{
  "requests": [
    { "requestId": "r1", "model": "gpt-4", "estimatedTokens": 1000 },
    { "requestId": "r2", "model": "gpt-4", "estimatedTokens": 1000 }
  ]
}</pre>
        </div>
      </div>
    </div>

    <h2>Metrics</h2>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method get">GET</span>
        <span class="path">/v2/metrics/live</span>
      </div>
      <div class="endpoint-content">
        <p>Returns real-time protection metrics for the authenticated account.</p>
        
        <div class="response">
{
  "requestsProtected": 15234,
  "costSavedToday": 847.50,
  "activeProtections": 3,
  "systemHealth": "healthy",
  "averageLatencyMs": 48
}</div>
      </div>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method get">GET</span>
        <span class="path">/v2/metrics/monthly</span>
      </div>
      <div class="endpoint-content">
        <p>Returns monthly aggregated metrics.</p>
        
        <div class="response">
{
  "month": "2024-05",
  "totalSaved": 1247.50,
  "totalRequests": 15234,
  "efficiencyScore": 94,
  "projectedAnnualSavings": 14970
}</div>
      </div>
    </div>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method get">GET</span>
        <span class="path">/v2/metrics/activity</span>
      </div>
      <div class="endpoint-content">
        <p>Returns recent protection activity stream.</p>
        
        <div class="response">
{
  "activity": [
    {
      "id": "evt_abc123",
      "timestamp": "2024-05-06T14:32:24Z",
      "type": "block",
      "moneySaved": 0.06,
      "reason": "Loop detected"
    }
  ]
}</div>
      </div>
    </div>

    <h2>Auto-Protection</h2>

    <div class="endpoint">
      <div class="endpoint-header">
        <span class="method post">POST</span>
        <span class="path">/v2/auto-protect/configure</span>
      </div>
      <div class="endpoint-content">
        <p>Configures automatic protection for AI clients without manual interception calls.</p>
        
        <table class="params-table">
          <tr>
            <th>Parameter</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
          <tr>
            <td>mode <span class="required">required</span></td>
            <td class="type">string</td>
            <td>"active" | "observe" | "off"</td>
          </tr>
          <tr>
            <td>autoAttach</td>
            <td class="type">boolean</td>
            <td>Auto-wrap global fetch/OpenAI</td>
          </tr>
          <tr>
            <td>targets</td>
            <td class="type">string[]</td>
            <td>["openai", "fetch", "axios"]</td>
          </tr>
        </table>

        <div class="code-block">
          <pre>POST /v2/auto-protect/configure
{
  "mode": "active",
  "autoAttach": true,
  "targets": ["openai", "fetch"]
}</pre>
        </div>
      </div>
    </div>

    <div class="section-divider"></div>

    <h2>Error Codes</h2>

    <table class="params-table" style="margin-bottom: 40px;">
      <tr>
        <th>Code</th>
        <th>HTTP</th>
        <th>Description</th>
      </tr>
      <tr>
        <td>rate_limited</td>
        <td class="type">429</td>
        <td>Request quota exceeded. Retry after reset.</td>
      </tr>
      <tr>
        <td>invalid_signature</td>
        <td class="type">401</td>
        <td>HMAC signature mismatch. Check secret.</td>
      </tr>
      <tr>
        <td>expired_request</td>
        <td class="type">401</td>
        <td>Timestamp too old. Regenerate signature.</td>
      </tr>
      <tr>
        <td>idempotency_conflict</td>
        <td class="type">409</td>
        <td>Key already used. Generate new key.</td>
      </tr>
      <tr>
        <td>invalid_payload</td>
        <td class="type">400</td>
        <td>Schema validation failed.</td>
      </tr>
    </table>

    <h2>Signed Request Example</h2>

    <div class="code-block">
      <pre>import crypto from 'crypto';

const API_KEY = 'ak_live_prod_xxxxx';
const API_SECRET = 'sk_xxxxx';  // From workspace

function signRequest(method, path, body) {
  const timestamp = Date.now();
  const bodyHash = crypto.createHash('sha256')
    .update(JSON.stringify(body))
    .digest('hex');
  
  const payload = \`\${API_KEY}:\${timestamp}:\${bodyHash}:\${path}:\${method}\`;
  const signature = crypto.createHmac('sha256', API_SECRET)
    .update(payload)
    .digest('hex');
  
  return {
    headers: {
      'Authorization': \`Bearer \${API_KEY}\`,
      'X-Signature': signature,
      'X-Timestamp': timestamp,
      'X-Idempotency-Key': crypto.randomUUID(),
    },
    body
  };
}</pre>
    </div>

    <footer>
      <a href="/status">System Status</a>
      <a href="/benchmarks">Benchmarks</a>
    </footer>
  </div>
</body>
</html>`;
}
