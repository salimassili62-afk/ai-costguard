/**
 * Express Server with AI Execution Firewall
 * 
 * This server demonstrates global middleware protection
 * where ALL AI requests are automatically analyzed
 * and blocked if they exceed cost or risk thresholds.
 */

import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import { expressFirewall, withFirewall } from 'ai-execution-firewall';
import OpenAI from 'openai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// 1. GLOBAL AI FIREWALL MIDDLEWARE
// This protects ALL routes automatically
// ============================================
app.use(express.json());

// Attach global firewall middleware
app.use(expressFirewall({
  trustMode: 'block',
  dailyBudget: 50,
  maxCost: 5,
  
  // Called when request is blocked
  onBlock: (req: Request, res: Response, reason: string, details: any) => {
    console.log('🔥 BLOCKED:', reason);
    console.log('   SAVED: $', details.estimatedCost);
    
    // Send response without reaching OpenAI
    res.status(403).json({
      error: 'Request blocked by AI Execution Firewall',
      reason,
      saved: details.estimatedCost,
      wouldHaveLost: details.wouldHaveLost,
      risk: details.riskLevel,
    });
  },
  
  // Called on warnings
  onWarn: (req: Request, res: Response, reason: string, details: any) => {
    console.log('⚠️ WARNING:', reason);
    // Continue to handler, but log the warning
  },
}));

// ============================================
// 2. PROTECTED OPENAI CLIENT
// ============================================
const openai = withFirewall(
  new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  {
    trustMode: 'block',
    dailyBudget: 50,
    maxCost: 5,
  }
);

// ============================================
// 3. ROUTES
// ============================================

// Health check (bypasses firewall)
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', firewall: 'active' });
});

// Chat endpoint - automatically protected
app.post('/api/chat', async (req: Request, res: Response) => {
  const { prompt, model = 'gpt-4' } = req.body;
  
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }
  
  try {
    // This call is double-protected:
    // 1. Global middleware analyzed the request
    // 2. SDK wrapper also analyzes
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1000,
    });
    
    const responseText = completion.choices[0]?.message?.content || '';
    
    // Attach cost info from middleware (if available)
    const aiInfo = (req as any).aiFirewall;
    
    res.json({
      text: responseText,
      model,
      usage: completion.usage,
      cost: aiInfo?.cost,
      risk: aiInfo?.risk,
    });
    
  } catch (error: any) {
    console.error('Error:', error);
    
    // Check if this was a firewall block
    if (error.error?.type === 'firewall_blocked') {
      return res.status(403).json({
        error: 'Blocked by AI Firewall',
        reason: error.error.reason,
        saved: error.error.estimatedCost,
      });
    }
    
    res.status(500).json({ error: 'Failed to generate response' });
  }
});

// Cost estimate endpoint
app.post('/api/estimate', async (req: Request, res: Response) => {
  const { prompt, model = 'gpt-4' } = req.body;
  
  // Just return estimate without calling API
  const estimatedTokens = Math.ceil(prompt.length / 4) + 1000;
  const inputCost = (estimatedTokens / 1000) * 0.03; // GPT-4 input
  const outputCost = (1000 / 1000) * 0.06; // GPT-4 output
  const totalCost = inputCost + outputCost;
  
  res.json({
    prompt,
    model,
    estimatedTokens,
    estimatedCost: Math.round(totalCost * 10000) / 10000,
    risk: totalCost > 0.5 ? 'MEDIUM' : 'LOW',
  });
});

// Stats endpoint
app.get('/api/stats', (req: Request, res: Response) => {
  // In production, fetch from actual stats store
  res.json({
    message: 'Run "aifw dashboard" for detailed stats',
    command: 'npx ai-execution-firewall dashboard',
  });
});

// ============================================
// 4. ERROR HANDLING
// ============================================

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// ============================================
// 5. START SERVER
// ============================================
app.listen(PORT, () => {
  console.log('🛡️  Express Server with AI Execution Firewall');
  console.log(`   Running on http://localhost:${PORT}`);
  console.log('');
  console.log('Endpoints:');
  console.log(`   GET  http://localhost:${PORT}/health`);
  console.log(`   POST http://localhost:${PORT}/api/chat`);
  console.log(`   POST http://localhost:${PORT}/api/estimate`);
  console.log(`   GET  http://localhost:${PORT}/api/stats`);
  console.log('');
  console.log('CLI Commands:');
  console.log('   npm run ai:dashboard');
  console.log('   npm run ai:budget -- --set 100');
  console.log('');
});
