import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';

/**
 * AI Chat API Route - Protected by AI Execution Firewall
 * 
 * This route is automatically protected because:
 * 1. The openai client is wrapped with guard()
 * 2. Firewall intercepts every request BEFORE it reaches OpenAI
 * 3. If risk is HIGH, request is blocked and money is saved
 */

export async function POST(request: NextRequest) {
  try {
    const { prompt, model = 'gpt-4' } = await request.json();

    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    // This call is automatically protected by the firewall
    // If HIGH risk detected, it throws with error.type === 'firewall_blocked'
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: 1000,
    });

    const responseText = completion.choices[0]?.message?.content || '';

    return NextResponse.json({
      text: responseText,
      model,
      usage: completion.usage,
    });

  } catch (error: any) {
    // Check if this is a firewall block
    if (error.error?.type === 'firewall_blocked' || error.type === 'firewall_blocked') {
      const blockInfo = error.error || error;
      
      return NextResponse.json(
        {
          error: 'Request blocked by AI Execution Firewall',
          reason: blockInfo.reason,
          dangerScore: blockInfo.dangerScore,
          saved: blockInfo.estimatedCost,
          category: blockInfo.category,
        },
        { status: 403 }
      );
    }

    // Regular error
    console.error('API Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate response' },
      { status: 500 }
    );
  }
}
