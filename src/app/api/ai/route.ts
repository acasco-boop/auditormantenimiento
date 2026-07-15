import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { prompt, max_tokens, temperature, apiKey, model, provider, baseUrl } = await req.json();

    const selectedProvider = provider || 'groq';
    const key = apiKey;
    const selectedModel = model;

    if (!key) {
      return NextResponse.json(
        { error: 'API Key no configurada. Por favor, ingrésela en la configuración de la app.' },
        { status: 400 }
      );
    }

    let url = '';
    if (selectedProvider === 'groq') {
      url = 'https://api.groq.com/openai/v1/chat/completions';
    } else if (selectedProvider === 'mimo') {
      const base = (baseUrl || 'https://token-plan-sgp.xiaomimimo.com/v1').replace(/\/$/, '');
      url = `${base}/chat/completions`;
    } else if (selectedProvider === 'lightning') {
      const base = (baseUrl || 'https://lightning.ai/api/v1').replace(/\/$/, '');
      url = `${base}/chat/completions`;
    } else {
      return NextResponse.json({ error: `Proveedor no soportado: ${selectedProvider}` }, { status: 400 });
    }

    const resp = await fetch(url, {
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
