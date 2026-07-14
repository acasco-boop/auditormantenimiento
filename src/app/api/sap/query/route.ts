import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { url, sessionId, queryId } = await req.json();

    if (!url || !sessionId || !queryId) {
      return NextResponse.json({ error: 'Faltan parámetros de consulta' }, { status: 400 });
    }

    const queryUrl = `${url.replace(/\/$/, '')}/SQLQueries('${queryId}')/List`;

    // Ignore SSL issues for internal SAP servers
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    const resp = await fetch(queryUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `B1SESSION=${sessionId}`,
      },
    });

    const data = await resp.json();

    if (!resp.ok) {
      return NextResponse.json({ error: data?.error?.message?.value || 'Error al ejecutar la consulta' }, { status: resp.status });
    }

    return NextResponse.json({ value: data.value });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
