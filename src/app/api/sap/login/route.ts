import { NextResponse } from 'next/server';
import https from 'https';

export async function POST(req: Request) {
  try {
    const { url, companyDB, userName, password } = await req.json();

    if (!url || !companyDB || !userName || !password) {
      return NextResponse.json({ error: 'Faltan credenciales de SAP' }, { status: 400 });
    }

    const loginUrl = `${url.replace(/\/$/, '')}/Login`;
    
    // Configurar fetch para que ignore certificados inválidos, muy común en Service Layer
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    // Since we are using native fetch in Next.js which might not support httpsAgent directly in some environments,
    // we set the global dispatcher or pass agent. For Next.js 14+ fetch, we can't easily pass agent.
    // Instead we will rely on standard fetch, but since Service Layer often has self-signed certs,
    // we'll tell Node to ignore them for this process:
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    const resp = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ CompanyDB: companyDB, UserName: userName, Password: password }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      return NextResponse.json({ error: data?.error?.message?.value || 'Error al conectar con SAP' }, { status: resp.status });
    }

    return NextResponse.json({ sessionId: data.SessionId });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
