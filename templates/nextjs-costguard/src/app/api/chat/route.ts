import { NextRequest, NextResponse } from 'next/server';
import { GuardError } from '@salimassili/ai-costguard';
import { openai } from '@/lib/openai';

export async function POST(request: NextRequest) {
  try {
    const { prompt, model = 'gpt-4o-mini' } = await request.json();

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: String(prompt) },
      ],
      max_tokens: 1000,
    });

    return NextResponse.json({
      text: completion.choices[0]?.message?.content ?? '',
      model,
      usage: completion.usage,
    });
  } catch (error) {
    if (error instanceof GuardError) {
      return NextResponse.json(
        {
          error: 'Blocked by AI CostGuard',
          code: error.code,
          reason: error.message,
          context: error.context,
        },
        { status: 403 }
      );
    }

    console.error('API Error:', error);
    return NextResponse.json({ error: 'Failed to generate response' }, { status: 500 });
  }
}
