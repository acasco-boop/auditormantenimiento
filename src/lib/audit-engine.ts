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

export function formatDate(val: any): string {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) {
    const d = val.getDate().toString().padStart(2, '0');
    const m = (val.getMonth() + 1).toString().padStart(2, '0');
    const y = val.getFullYear();
    return `${d}/${m}/${y}`;
  }
  const str = String(val).trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    return str;
  }
  if (str.includes('-') || str.includes('GMT') || str.includes('T')) {
    const parsed = Date.parse(str);
    if (!isNaN(parsed)) {
      const dateObj = new Date(parsed);
      const d = dateObj.getDate().toString().padStart(2, '0');
      const m = (dateObj.getMonth() + 1).toString().padStart(2, '0');
      const y = dateObj.getFullYear();
      return `${d}/${m}/${y}`;
    }
  }
  return str;
}

export function explicitReplacementNeeded(tareaUp: string): boolean {
  if (!tareaUp) return false;
  const controlKw = ['CONTROLAR','REVISION','REVISAR','CHEQUEAR','CONTROL'];
  if (controlKw.some(k => tareaUp.includes(k)) && tareaUp.includes('SELECTORA')) return false;
  const revKw = ['REVISION','REVISAR','CHEQUEAR'];
  if (revKw.some(k => tareaUp.includes(k))) return false;
  
  const actionKw = ['CAMBIAR', 'CAMBIO', 'COLOCAR', 'COLOCACION', 'INSTALAR', 'REEMPLAZAR', 'COLOCA', 'COLCAR'];
  
  // Separar en palabras limpias
  const words = tareaUp.split(/[^A-Z]/).map(w => w.trim()).filter(Boolean);
  
  return words.some(word => {
    if (actionKw.includes(word)) return true;
    return actionKw.some(kw => {
      // Para verbos de acción somos más estrictos (máxima distancia de 1)
      // Esto evita que "SOLDAR" (6 letras) coincida con "COLCAR" (6 letras, distancia 2)
      const len1 = word.length;
      const len2 = kw.length;
      if (Math.abs(len1 - len2) > 1) return false;
      return levenshtein(word, kw) === 1;
    });
  });
}

function levenshtein(a: string, b: string): number {
  const tmp: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    tmp[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    tmp[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1, // deletion
        tmp[i][j - 1] + 1, // insertion
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1) // substitution
      );
    }
  }
  return tmp[a.length][b.length];
}

export function isFuzzyMatch(word1: string, word2: string): boolean {
  if (word1 === word2) return true;
  const len1 = word1.length;
  const len2 = word2.length;
  if (Math.abs(len1 - len2) > 2) return false;
  
  const dist = levenshtein(word1, word2);
  if (dist === 1) return true;
  if (dist === 2 && Math.max(len1, len2) >= 5) return true; // Reducido a 5 para tolerar transposiciones en palabras cortas como REALY -> RELAY
  return false;
}

export function getMatchingCategories(tareaUp: string, activeParts: Record<string, string[]>): string[] {
  const matches: string[] = [];
  const stopWords = new Set(['DE', 'DEL', 'CON', 'SIN', 'POR', 'PARA', 'LOS', 'LAS', 'UNA', 'UNO', 'UNOS', 'UNAS', 'ESTE', 'ESTA', 'COMO', 'MAS', 'QUE', 'DELA']);
  const actionWords = new Set(['CAMBIAR', 'CAMBIO', 'COLOCAR', 'COLOCACION', 'INSTALAR', 'REEMPLAZAR', 'COLOCA', 'COLCAR']);
  
  const isValidSynonym = (syn: string) => {
    const s = syn.trim();
    if (!s) return false;
    if (s.includes(' ')) return true; // Las frases compuestas siempre son válidas
    if (s.length <= 2) return false;   // Descartar conectores de 1 o 2 letras
    if (stopWords.has(s)) return false; // Descartar stop-words comunes
    return true;
  };

  // Separar la tarea en palabras limpias
  const taskWords = tareaUp.split(/[^A-Z0-9ÁÉÍÓÚÑ]/).map(w => w.trim()).filter(Boolean);
  
  // Palabras filtradas de la tarea para comparación
  const taskWordsFiltered = taskWords.filter(w => !stopWords.has(w) && !actionWords.has(w));
  
  const isWordMatch = (taskWord: string, syn: string) => {
    if (taskWord === syn) return true;
    if (taskWord === syn + 'S') return true;  // Soporte para plurales
    if (taskWord === syn + 'ES') return true; // Soporte para plurales
    return false;
  };

  // Permite emparejar una frase (como "BASE SOPORTE AIRE ACONDICIONADO" o "CANO INTERCOOLER")
  // palabra por palabra contra la tarea, ignorando stop-words/conectores y tolerando errores de ortografía.
  const isPhraseMatch = (phrase: string) => {
    const phraseWords = phrase.split(/[^A-Z0-9]/).map(w => w.trim()).filter(w => w && !stopWords.has(w) && !actionWords.has(w));
    if (phraseWords.length === 0) return false;
    
    let taskIdx = 0;
    for (const pWord of phraseWords) {
      let found = false;
      for (let i = taskIdx; i < taskWordsFiltered.length; i++) {
        const tWord = taskWordsFiltered[i];
        if (isWordMatch(tWord, pWord) || isFuzzyMatch(tWord, pWord)) {
          found = true;
          taskIdx = i + 1; // Preservar orden relativo de palabras
          break;
        }
      }
      if (!found) return false;
    }
    return true;
  };

  // 1. Primero intentar coincidencias por frase o palabra completa
  for (const cat in activeParts) {
    const synonyms = activeParts[cat] || [];
    
    // Validar y comparar la categoría principal
    let matchesCat = false;
    if (isValidSynonym(cat)) {
      if (cat.includes(' ')) {
        matchesCat = isPhraseMatch(cat);
      } else {
        matchesCat = taskWordsFiltered.some(w => isWordMatch(w, cat));
      }
    }
    
    // Validar y comparar los sinónimos
    const matchesSyn = synonyms.some(syn => {
      const synUp = up(syn);
      if (!isValidSynonym(synUp)) return false;
      if (synUp.includes(' ')) {
        return isPhraseMatch(synUp);
      } else {
        return taskWordsFiltered.some(w => isWordMatch(w, synUp));
      }
    });
    
    if (matchesCat || matchesSyn) {
      matches.push(cat);
    }
  }
  
  if (matches.length > 0) {
    return matches;
  }
  
  // 2. Si no hay coincidencias exactas o de frase, buscar coincidencias difusas por palabra suelta
  const wordsForFuzzy = taskWordsFiltered.filter(w => w.length >= 4);
  for (const cat in activeParts) {
    const synonyms = activeParts[cat] || [];
    const matchesFuzzy = wordsForFuzzy.some(word => {
      if (cat.length >= 4 && !cat.includes(' ') && isFuzzyMatch(word, cat)) return true;
      return synonyms.some(syn => {
        const synUp = up(syn);
        return synUp.length >= 4 && !synUp.includes(' ') && isFuzzyMatch(word, synUp);
      });
    });
    
    if (matchesFuzzy) {
      matches.push(cat);
    }
  }
  
  return matches;
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

  // Órdenes indexadas por Nro. orden → { tipoOrden, centrosCostos, contabilizada, fechaOrden, statusDoc }
  const ordByOrder: Record<string, {
    tipoOrden: string;
    centrosCostos: string;
    contabilizada: string;
    fechaOrden: string;
    statusDoc: string;
  }> = {};
  if (dfOrd && dfOrd.length > 0) {
    dfOrd.forEach(r => {
      const key = String(r['Nro. orden'] ?? '');
      if (!key) return;
      if (!ordByOrder[key]) {
        ordByOrder[key] = {
          tipoOrden: String(r['Tipo de orden'] || '').trim(),
          centrosCostos: String(r['Centos de costos'] || '').trim(),
          contabilizada: String(r['Contabilizada'] || '').trim(),
          fechaOrden: formatDate(r['Fecha de la orden']),
          statusDoc: String(r['Status de documento'] || '').trim(),
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

    const matchedCategories = getMatchingCategories(tareaUp, activeParts);
    const matchesKnownCategory = matchedCategories.length > 0;
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
        'Contabilizada': ordData.contabilizada || undefined,
        'Fecha de la orden': ordData.fechaOrden || undefined,
        'Status de documento': ordData.statusDoc || undefined,
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
      for (const cat of matchedCategories) {
        const matsKws = activeParts[cat];
        const found = matList.some(m => matsKws.some(mk => m.includes(up(mk))));
        if (!found) missingCategories.push(cat);
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