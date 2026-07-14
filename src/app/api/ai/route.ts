import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { prompt, max_tokens, temperature, apiKey, model } = await req.json();

    const key = apiKey || process.env.GROQ_API_KEY;
    const selectedModel = model || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

    if (!key) {
      return NextResponse.json(
        { error: 'API Key de Groq no configurada. Por favor, ingrésela en la configuración de la app.' },
        { status: 400 }
      );
    }

    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: temperature !== undefined ? temperature : 0.3,
        max_tokens: max_tokens || undefined,
      }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      const errorMsg = data?.error?.message || data?.error || JSON.stringify(data);
      return NextResponse.json({ error: errorMsg }, { status: resp.status });
    }

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
