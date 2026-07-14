import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { prompt, max_tokens, temperature } = await req.json();

    const resp = await fetch('https://lightning.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer sk-lit-f9e96bf7-dec8-46f5-8c84-22162f59460f`,
      },
      body: JSON.stringify({
        model: 'anthropic/claude-fable-5',
        messages: [{ role: 'user', content: prompt }],
        temperature: temperature || 0.3,
        max_tokens: max_tokens || undefined,
      }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      return NextResponse.json({ error: data }, { status: resp.status });
    }

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
