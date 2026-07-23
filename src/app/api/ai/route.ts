import { NextResponse } from 'next/server';

/**
 * Fallback de API Key / Base URL por proveedor, leído de variables de
 * entorno del servidor. Si el cliente no envía `apiKey`/`baseUrl` en el
 * body (por ejemplo, si no se configuró nada en el navegador), se usa el
 * valor del servidor. Esto permite desplegar la app con una key "de
 * organización" sin depender de que cada usuario cargue la suya en
 * localStorage. Ver README (sección "Configuración de IA") para el listado
 * completo de variables soportadas.
 */
function getServerFallback(provider: string): { apiKey?: string; baseUrl?: string } {
  switch (provider) {
    case 'groq':
      return { apiKey: process.env.GROQ_API_KEY };
    case 'mimo':
      return { apiKey: process.env.MIMO_API_KEY, baseUrl: process.env.MIMO_BASE_URL };
    case 'lightning':
      return { apiKey: process.env.LIGHTNING_API_KEY, baseUrl: process.env.LIGHTNING_BASE_URL };
    case 'ollama':
      return { baseUrl: process.env.OLLAMA_BASE_URL };
    default:
      return {};
  }
}

export async function POST(req: Request) {
  try {
    const { prompt, max_tokens, temperature, apiKey, model, provider, baseUrl } = await req.json();

    const selectedProvider = provider || 'groq';
    const fallback = getServerFallback(selectedProvider);
    const key = apiKey || fallback.apiKey;
    const selectedModel = model;
    const effectiveBaseUrl = baseUrl || fallback.baseUrl;

    if (!key && selectedProvider !== 'ollama') {
      return NextResponse.json(
        { error: 'API Key no configurada. Ingrésela en la configuración de la app o defina la variable de entorno correspondiente en el servidor (ver README).' },
        { status: 400 }
      );
    }

    let url = '';
    if (selectedProvider === 'groq') {
      url = 'https://api.groq.com/openai/v1/chat/completions';
    } else if (selectedProvider === 'mimo') {
      const base = (effectiveBaseUrl || 'https://token-plan-sgp.xiaomimimo.com/v1').replace(/\/$/, '');
      url = `${base}/chat/completions`;
    } else if (selectedProvider === 'lightning') {
      const base = (effectiveBaseUrl || 'https://lightning.ai/api/v1').replace(/\/$/, '');
      url = `${base}/chat/completions`;
    } else if (selectedProvider === 'ollama') {
      const base = (effectiveBaseUrl || 'http://localhost:11434/v1').replace(/\/$/, '');
      url = `${base}/chat/completions`;
    } else {
      return NextResponse.json({ error: `Proveedor no soportado: ${selectedProvider}` }, { status: 400 });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (key) {
      headers['Authorization'] = `Bearer ${key}`;
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers,
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
