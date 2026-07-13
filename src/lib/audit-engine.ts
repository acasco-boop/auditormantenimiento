import type { TareaRow, MaterialRow, OrdenRow, AuditResult, UnrecognizedTask, MetricBreakdown } from './audit-types';
import { PARTS_TO_CHECK } from './parts-dictionary';

export function stripAccents(str: string): string {
  return str
    .replace(/[ÁÀÄÂ]/g,'A').replace(/[ÉÈËÊ]/g,'E').replace(/[ÍÌÏÎ]/g,'I')
    .replace(/[ÓÒÖÔ]/g,'O').replace(/[ÚÙÜÛ]/g,'U').replace(/Ñ/g,'N');
}

export function up(v: unknown): string {
  if (v === null || v === undefined) return '';
  return stripAccents(String(v).toUpperCase());
}

export function explicitReplacementNeeded(tareaUp: string): boolean {
  if (!tareaUp) return false;
  const controlKw = ['CONTROLAR','REVISION','REVISAR','CHEQUEAR','CONTROL'];
  if (controlKw.some(k => tareaUp.includes(k)) && tareaUp.includes('SELECTORA')) return false;
  const revKw = ['REVISION','REVISAR','CHEQUEAR'];
  if (revKw.some(k => tareaUp.includes(k))) return false;
  const actionKw = ['CAMBIAR','REEMPLAZAR','COLOCAR','COLOCACION','INSTALAR','CAMBIO'];
  return actionKw.some(k => tareaUp.includes(k));
}

export function normalizeOrderCol(
  rows: Record<string, unknown>[],
  primaryCol: string
): boolean {
  if (rows.length === 0) return false;
  const cols = Object.keys(rows[0]);
  if (cols.includes(primaryCol)) {
    rows.forEach(r => { r['Nro. Orden'] = r[primaryCol]; });
    return true;
  } else if (cols.includes('Nro. Orden')) {
    return true;
  }
  return false;
}

export interface AuditOutput {
  results: AuditResult[];
  unrecognizedTasks: UnrecognizedTask[];
  matByOrder: Record<string, MaterialRow[]>;
  metrics: {
    c1: number; c2: number; c3: number;
    b1: MetricBreakdown; b2: MetricBreakdown; b3: MetricBreakdown;
  };
}

export function runAudit(
  dfTar: TareaRow[],
  dfMat: MaterialRow[],
  customDict: Record<string, string[]> = {},
  dfOrd: OrdenRow[] | null = null
): AuditOutput {
  const okTar = normalizeOrderCol(dfTar as unknown as Record<string, unknown>[], 'DocNum');
  if (!okTar) throw new Error('No se encontró la columna de Orden (DocNum o Nro. Orden) en el archivo de Tareas.');

  const okMat = normalizeOrderCol(dfMat as unknown as Record<string, unknown>[], 'Nro. OM');
  if (!okMat) throw new Error('No se encontró la columna de Orden (Nro. OM o Nro. Orden) en el archivo de Materiales.');

  // Materiales indexados por Nro. Orden
  const matByOrder: Record<string, MaterialRow[]> = {};
  dfMat.forEach(r => {
    const key = String(r['Nro. Orden']);
    if (!matByOrder[key]) matByOrder[key] = [];
    matByOrder[key].push(r);
  });

  // Órdenes indexadas por Nro. orden → { tipoOrden, centrosCostos }
  const ordByOrder: Record<string, { tipoOrden: string; centrosCostos: string }> = {};
  if (dfOrd && dfOrd.length > 0) {
    dfOrd.forEach(r => {
      const key = String(r['Nro. orden'] ?? '');
      if (!key) return;
      if (!ordByOrder[key]) {
        ordByOrder[key] = {
          tipoOrden: String(r['Tipo de orden'] || '').trim(),
          centrosCostos: String(r['Centos de costos'] || '').trim(),
        };
      }
    });
  }

  const activeParts = { ...PARTS_TO_CHECK, ...customDict };
  const unrecognizedMap: Record<string, UnrecognizedTask> = {};
  const results: AuditResult[] = [];

  dfTar.forEach(row => {
    const tarea = row['Tarea'] === null || row['Tarea'] === undefined ? '' : String(row['Tarea']);
    const tareaUp = up(tarea);
    if (!explicitReplacementNeeded(tareaUp)) return;

    const order = row['Nro. Orden']!;

    const matchesKnownCategory = Object.keys(activeParts).some(kw => tareaUp.includes(kw));
    if (!matchesKnownCategory) {
      const key = tareaUp;
      if (!unrecognizedMap[key]) unrecognizedMap[key] = { tarea, count: 0, order };
      unrecognizedMap[key].count++;
    }

    const mats = matByOrder[String(order)] || [];
    const matList = mats.map(m => up(m['Desc. Artículo']));
    const totalSalidas = mats.reduce((acc, m) => {
      const v = parseFloat(String(m['Salidas']));
      return acc + (isNaN(v) ? 0 : v);
    }, 0);

    const ordData = ordByOrder[String(order)];
    const base: AuditResult = {
      'Nro. Orden': order,
      'Equipo': String(row['Codigo equipo'] || ''),
      'Nombre Equipo': String(row['Nombre Equipo'] || ''),
      'Tarea': tarea,
      'Estado Tarea': String(row['Estado'] || ''),
      'Tipo de Hallazgo': '',
      'Detalle': '',
      ...(ordData ? {
        'Tipo de orden': ordData.tipoOrden || undefined,
        'Centros de costos': ordData.centrosCostos || undefined,
      } : {}),
    };

    if (mats.length === 0) {
      results.push({ ...base,
        'Tipo de Hallazgo': '1) Orden sin repuestos asignados',
        'Detalle': 'Ningún material cargado en la orden',
      });
    } else if (totalSalidas === 0) {
      results.push({ ...base,
        'Tipo de Hallazgo': '3) Planificado sin Salida física (Salidas = 0)',
        'Detalle': 'Materiales planificados con Salida Cero: ' + mats.map(m => String(m['Desc. Artículo'] || '')).join(', '),
      });
    } else {
      const missingCategories: string[] = [];
      for (const kw in activeParts) {
        if (tareaUp.includes(kw)) {
          const matsKws = activeParts[kw];
          const found = matList.some(m => matsKws.some(mk => m.includes(mk)));
          if (!found) missingCategories.push(kw);
        }
      }
      if (missingCategories.length > 0) {
        results.push({ ...base,
          'Tipo de Hallazgo': `2) Desconexión de material (Falta '${missingCategories.join("', '")}')`,
          'Detalle': 'Materiales cargados no coinciden: ' + mats.map(m => String(m['Desc. Artículo'] || '')).join(', '),
        });
      }
    }
  });

  const unrecognizedTasks = Object.values(unrecognizedMap).sort((a, b) => b.count - a.count);

  // Calculate metrics
  const r1 = results.filter(r => r['Tipo de Hallazgo'].startsWith('1)'));
  const r2 = results.filter(r => r['Tipo de Hallazgo'].startsWith('2)'));
  const r3 = results.filter(r => r['Tipo de Hallazgo'].startsWith('3)'));

  const calcBreakdown = (subset: AuditResult[], hasWarehouse: boolean): MetricBreakdown => {
    const uniqueOMs = [...new Set(subset.map(r => String(r['Nro. Orden'])))];
    const warehouses: Record<string, number> = {};
    const tiposOrden: Record<string, number> = {};
    if (hasWarehouse) {
      uniqueOMs.forEach(om => {
        const mats = matByOrder[om] || [];
        mats.forEach(m => {
          const wh = String(m['Almacen'] || '').trim();
          if (!wh) return;
          warehouses[wh] = (warehouses[wh] || 0) + 1;
        });
      });
    }
    // Breakdown por tipo de orden
    subset.forEach(r => {
      const tipo = String(r['Tipo de orden'] || 'Sin dato').trim();
      if (tipo) tiposOrden[tipo] = (tiposOrden[tipo] || 0) + 1;
    });
    return {
      taskCount: subset.length,
      uniqueOMs: uniqueOMs.length,
      warehouses: Object.entries(warehouses)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      tiposOrden: Object.entries(tiposOrden)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    };
  };

  return {
    results,
    unrecognizedTasks,
    matByOrder,
    metrics: {
      c1: r1.length, c2: r2.length, c3: r3.length,
      b1: calcBreakdown(r1, false),
      b2: calcBreakdown(r2, true),
      b3: calcBreakdown(r3, true),
    },
  };
}