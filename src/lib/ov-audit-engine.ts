import { stripAccents } from './audit-engine';

export interface OVRow {
  'Nro Ovta'?: string | number | null;
  'Número de artículo'?: string | null;
  'Descripción artículo/serv.'?: string | null;
  'Cantidad'?: string | number | null;
  'Equipo CMMS'?: string | null;
  'Taller CMMS'?: string | null;
  'Código de almacén'?: string | null;
  'OM CMMS'?: string | number | null;
  'DocNum'?: string | number | null;
  'Tipo de orden'?: string | null;
  'Nro Entrega'?: string | number | null;
  'Total líneas'?: string | number | null;
  [key: string]: unknown;
}

export interface OVMatRow {
  'Nro Ovta'?: string | number | null;
  'Artículo'?: string | null;
  'Desc. Artículo'?: string | null;
  'Salidas'?: string | number | null;
  'Cant. planificada'?: string | number | null;
  'Almacen'?: string | null;
  'Equipo'?: string | null;
  'Nro. OM'?: string | number | null;
  [key: string]: unknown;
}

export interface OVFinding {
  'Nro Ovta': string | number;
  'Artículo OV': string;
  'Desc. OV': string;
  'Cant. OV': number;
  'Artículo Mat': string;
  'Desc. Mat': string;
  'Cant. Mat': number;
  'Tipo de Hallazgo': string;
  'Detalle': string;
  'Taller': string;
  'Equipo': string;
  'Nro. OM'?: string | number | null;
}

export interface OVMetricBreakdown {
  totalOVs: number;
  ovsConDiscrepancia: number;
  totalItemsOV: number;
  totalItemsMat: number;
  tiposHallazgo: { name: string; count: number }[];
  porTaller: { name: string; count: number }[];
}

export interface OVAuditOutput {
  findings: OVFinding[];
  metrics: OVMetricBreakdown;
  ovItemsByOvta: Record<string, OVRow[]>;
  matItemsByOvta: Record<string, OVMatRow[]>;
}

function parseNum(v: unknown): number {
  const n = parseFloat(String(v ?? ''));
  return isNaN(n) ? 0 : n;
}

function normalizeArticulo(v: unknown): string {
  return stripAccents(String(v ?? '').toUpperCase().trim());
}

export function runOVAudit(
  dfOV: OVRow[],
  dfMat: OVMatRow[]
): OVAuditOutput {
  // Index OV items by Nro Ovta
  const ovItemsByOvta: Record<string, OVRow[]> = {};
  dfOV.forEach(r => {
    const key = String(r['Nro Ovta'] ?? '').trim();
    if (!key) return;
    if (!ovItemsByOvta[key]) ovItemsByOvta[key] = [];
    ovItemsByOvta[key].push(r);
  });

  // Index Mat items by Nro Ovta
  const matItemsByOvta: Record<string, OVMatRow[]> = {};
  dfMat.forEach(r => {
    const key = String(r['Nro Ovta'] ?? '').trim();
    if (!key) return;
    if (!matItemsByOvta[key]) matItemsByOvta[key] = [];
    matItemsByOvta[key].push(r);
  });

  const findings: OVFinding[] = [];

  // All Ovtas from both files
  const allOvtas = new Set([...Object.keys(ovItemsByOvta), ...Object.keys(matItemsByOvta)]);

  allOvtas.forEach(ovta => {
    const ovRows = ovItemsByOvta[ovta] || [];
    const matRows = matItemsByOvta[ovta] || [];

    // Filter out service lines (V-SRV*, V-MO, etc.) from OV — only compare material lines
    const ovMaterialRows = ovRows.filter(r => {
      const art = normalizeArticulo(r['Número de artículo']);
      return art && !art.startsWith('V-SRV') && !art.startsWith('V-MO');
    });

    // Build maps by article code
    const ovMap = new Map<string, { row: OVRow; cant: number }>();
    ovMaterialRows.forEach(r => {
      const art = normalizeArticulo(r['Número de artículo']);
      if (!art) return;
      // Sum quantities for same article
      if (ovMap.has(art)) {
        ovMap.get(art)!.cant += parseNum(r['Cantidad']);
      } else {
        ovMap.set(art, { row: r, cant: parseNum(r['Cantidad']) });
      }
    });

    const matMap = new Map<string, { row: OVMatRow; cant: number }>();
    matRows.forEach(r => {
      const art = normalizeArticulo(r['Artículo']);
      if (!art) return;
      if (matMap.has(art)) {
        matMap.get(art)!.cant += parseNum(r['Salidas']);
      } else {
        matMap.set(art, { row: r, cant: parseNum(r['Salidas']) });
      }
    });

    const firstOvRow = ovRows[0];
    const taller = String(firstOvRow?.['Taller CMMS'] || matRows[0]?.['Almacen'] || '');
    const equipo = String(firstOvRow?.['Equipo CMMS'] || matRows[0]?.['Equipo'] || '');

    // Type 1: In OV but not in Material
    ovMap.forEach((ovData, art) => {
      if (!matMap.has(art)) {
        findings.push({
          'Nro Ovta': ovta,
          'Artículo OV': art,
          'Desc. OV': String(ovData.row['Descripción artículo/serv.'] || ''),
          'Cant. OV': ovData.cant,
          'Artículo Mat': '',
          'Desc. Mat': '',
          'Cant. Mat': 0,
          'Tipo de Hallazgo': '1) En OV, sin coincidencia en Material',
          'Detalle': `Artículo ${art} facturado en OV pero no encontrado en el registro de materiales`,
          'Taller': taller,
          'Equipo': equipo,
          'Nro. OM': matRows[0]?.['Nro. OM'] || '',
        });
      }
    });

    // Type 2: In Material but not in OV
    matMap.forEach((matData, art) => {
      if (!ovMap.has(art)) {
        findings.push({
          'Nro Ovta': ovta,
          'Artículo OV': '',
          'Desc. OV': '',
          'Cant. OV': 0,
          'Artículo Mat': art,
          'Desc. Mat': String(matData.row['Desc. Artículo'] || ''),
          'Cant. Mat': matData.cant,
          'Tipo de Hallazgo': '2) En Material, sin coincidencia en OV',
          'Detalle': `Artículo ${art} retirado de stock pero no está en la orden de venta`,
          'Taller': taller,
          'Equipo': equipo,
          'Nro. OM': matData.row['Nro. OM'] || '',
        });
      }
    });

    // Type 3: In both but different quantities
    ovMap.forEach((ovData, art) => {
      const matData = matMap.get(art);
      if (!matData) return;
      if (Math.abs(ovData.cant - matData.cant) > 0.001) {
        findings.push({
          'Nro Ovta': ovta,
          'Artículo OV': art,
          'Desc. OV': String(ovData.row['Descripción artículo/serv.'] || ''),
          'Cant. OV': ovData.cant,
          'Artículo Mat': art,
          'Desc. Mat': String(matData.row['Desc. Artículo'] || ''),
          'Cant. Mat': matData.cant,
          'Tipo de Hallazgo': '3) Diferencia de cantidad',
          'Detalle': `OV: ${ovData.cant} uds — Material: ${matData.cant} uds (diferencia: ${Math.abs(ovData.cant - matData.cant).toFixed(2)})`,
          'Taller': taller,
          'Equipo': equipo,
          'Nro. OM': matData.row['Nro. OM'] || '',
        });
      }
    });
  });

  // Calculate metrics
  const ovsConDiscrepancia = new Set(findings.map(f => String(f['Nro Ovta']))).size;
  const tiposHallazgo: Record<string, number> = {};
  findings.forEach(f => {
    const tipo = f['Tipo de Hallazgo'];
    tiposHallazgo[tipo] = (tiposHallazgo[tipo] || 0) + 1;
  });
  const porTaller: Record<string, number> = {};
  findings.forEach(f => {
    const t = f['Taller'] || 'Sin taller';
    porTaller[t] = (porTaller[t] || 0) + 1;
  });

  // Count total material items (excluding service lines)
  let totalItemsOV = 0;
  dfOV.forEach(r => {
    const art = normalizeArticulo(r['Número de artículo']);
    if (art && !art.startsWith('V-SRV') && !art.startsWith('V-MO')) totalItemsOV++;
  });
  let totalItemsMat = 0;
  dfMat.forEach(r => {
    const art = normalizeArticulo(r['Artículo']);
    if (art) totalItemsMat++;
  });

  return {
    findings,
    metrics: {
      totalOVs: allOvtas.size,
      ovsConDiscrepancia,
      totalItemsOV,
      totalItemsMat,
      tiposHallazgo: Object.entries(tiposHallazgo)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      porTaller: Object.entries(porTaller)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    },
    ovItemsByOvta,
    matItemsByOvta,
  };
}

// AI-powered fuzzy match: find potential article matches between OV and Material
export interface AIMatchSuggestion {
  ovArticulo: string;
  ovDesc: string;
  matArticulo: string;
  matDesc: string;
  ovta: string;
  confidence: string; // 'Alta' | 'Media' | 'Baja'
  razon: string;
}

export function buildFuzzyMatchPrompt(findings: OVFinding[]): string {
  const type1 = findings.filter(f => f['Tipo de Hallazgo'].startsWith('1)')).slice(0, 15);
  const type2 = findings.filter(f => f['Tipo de Hallazgo'].startsWith('2)')).slice(0, 15);

  if (type1.length === 0 && type2.length === 0) return '';

  let prompt = `Sos un experto en repuestos de flotas de transporte pesado. Analizá estas discrepancias entre una Orden de Venta y el registro de Materiales del sistema CMMS.\n\n`;

  if (type1.length > 0) {
    prompt += `=== ARTÍCULOS EN OV SIN COINCIDENCIA EN MATERIAL ===\n`;
    type1.forEach((f, i) => {
      prompt += `${i + 1}. OV ${f['Nro Ovta']} | Art: ${f['Artículo OV']} | Desc: ${f['Desc. OV']} | Cant: ${f['Cant. OV']}\n`;
    });
    prompt += '\n';
  }

  if (type2.length > 0) {
    prompt += `=== ARTÍCULOS EN MATERIAL SIN COINCIDENCIA EN OV ===\n`;
    type2.forEach((f, i) => {
      prompt += `${i + 1}. OV ${f['Nro Ovta']} | Art: ${f['Artículo Mat']} | Desc: ${f['Desc. Mat']} | Cant: ${f['Cant. Mat']}\n`;
    });
    prompt += '\n';
  }

  prompt += `Para cada artículo huérfano, buscá si existe una coincidencia probable en la otra lista (por similitud de descripción, código similar, o nombre de repuesto).
Si la OV tiene un artículo que no está en Material, pero en Material hay uno con descripción muy similar para la misma OV, es un cruce probable.
Respondé ÚNICAMENTE con un array JSON válido:
[{"ovArticulo":"...","ovDesc":"...","matArticulo":"...","matDesc":"...","ovta":"...","confidence":"Alta|Media|Baja","razon":"..."}]
Solo incluí los que tengan coincidencia probable. Si no hay ninguna, devolvé []. Sin texto adicional.`;

  return prompt;
}