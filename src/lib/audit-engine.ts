import type { TareaRow, MaterialRow, OrdenRow, AuditResult, UnrecognizedTask, MetricBreakdown } from './audit-types';
import { PARTS_TO_CHECK, LUBRICANT_CATEGORIES } from './parts-dictionary';

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

export function isInsumoOFerreteria(textUp: string): boolean {
  const keywords = [
    'TORNILLO', 'TUERCA', 'BULON', 'BULON', 'ARANDELA', 'ABRAZADERA', 'PRECINTO', 
    'CINTA', 'PEGAMENTO', 'SILICONA', 'TRAPO', 'DISCO DE CORTE', 'DISCO DE DESBASTE', 
    'LIJA', 'HERRAMIENTA', 'PINTURA', 'SELLADOR', 'ALAMBRE', 'GRILLETE', 
    'PASADOR', 'ELECTRODO', 'SELLAR', 'TIE WRAP', 'ZIPTIE', 'PRECINTOS', 
    'BULONES', 'TORNILLOS', 'TUERCAS', 'ARANDELAS', 'ABRAZADERAS', 'SELLADORES', 
    'MANGUITO', 'ORING', 'O-RING'
  ];
  const cleanText = up(textUp);
  return keywords.some(kw => cleanText.includes(up(kw)));
}

// ---------------------------------------------------------------------------
// Normalización de verbos/acciones de taller.
//
// El sistema necesita agrupar variantes de un mismo verbo de acción
// (conjugaciones, sustantivaciones, errores de tipeo frecuentes) bajo una
// única "categoría lógica de acción" ANTES de intentar el cruce con los
// materiales. Esto es lo que permite que "Cambio" y "Cambiar" se traten
// como la misma acción, que "Coloco" (antes NO coincidía con "Colocar" por
// estar a distancia de edición 2, así que esas tareas se ignoraban por
// completo) sea reconocido, y que "Agregar"/"Engrase" (que ni siquiera
// estaban en la lista de verbos) disparen el cruce de materiales.
// ---------------------------------------------------------------------------

/** Categorías lógicas de acción reconocidas por el motor. */
export type ActionType = 'REEMPLAZO' | 'COLOCACION' | 'AGREGADO' | 'LUBRICACION';

/**
 * Diccionario de variantes -> categoría lógica de acción.
 * Cada entrada agrupa conjugaciones/derivaciones de un mismo verbo para que
 * el resto del motor no tenga que lidiar con cada variante por separado.
 */
export const ACTION_SYNONYMS: Record<string, ActionType> = {
  // Cambio / Cambiar
  CAMBIO: 'REEMPLAZO', CAMBIOS: 'REEMPLAZO', CAMBIAR: 'REEMPLAZO', CAMBIA: 'REEMPLAZO',
  CAMBIAN: 'REEMPLAZO', CAMBIANDO: 'REEMPLAZO', REEMPLAZO: 'REEMPLAZO', REEMPLAZOS: 'REEMPLAZO',
  REEMPLAZAR: 'REEMPLAZO', REEMPLAZA: 'REEMPLAZO',
  // Coloco / Colocar
  COLOCO: 'COLOCACION', COLOCAR: 'COLOCACION', COLOCA: 'COLOCACION', COLOCAN: 'COLOCACION',
  COLOCACION: 'COLOCACION', COLOCADO: 'COLOCACION', COLOCANDO: 'COLOCACION', COLCAR: 'COLOCACION',
  INSTALAR: 'COLOCACION', INSTALACION: 'COLOCACION', INSTALA: 'COLOCACION',
  // Agregar
  AGREGAR: 'AGREGADO', AGREGO: 'AGREGADO', AGREGADO: 'AGREGADO', AGREGA: 'AGREGADO',
  AGREGAN: 'AGREGADO', RELLENAR: 'AGREGADO', RELLENO: 'AGREGADO', RELLENA: 'AGREGADO',
  // Engrase
  ENGRASE: 'LUBRICACION', ENGRASAR: 'LUBRICACION', ENGRASO: 'LUBRICACION', ENGRASA: 'LUBRICACION',
  ENGRASAN: 'LUBRICACION', ENGRASADO: 'LUBRICACION', LUBRICACION: 'LUBRICACION', LUBRICAR: 'LUBRICACION',
};

/** Devuelve la categoría lógica de acción de una palabra ya normalizada (MAYUS/sin tildes), o null. */
export function normalizeActionWord(word: string): ActionType | null {
  return ACTION_SYNONYMS[word] ?? null;
}

/**
 * Recorre la tarea (en mayúsculas/sin tildes) y devuelve la primera
 * categoría lógica de acción detectada, o null si no se reconoce ninguna.
 */
export function getActionType(tareaUp: string): ActionType | null {
  if (!tareaUp) return null;
  const words = tareaUp.split(/[^A-Z]/).map(w => w.trim()).filter(Boolean);
  for (const word of words) {
    const direct = normalizeActionWord(word);
    if (direct) return direct;
    // Tolerancia a errores de tipeo leves (distancia de edición 1) contra cada variante conocida.
    for (const variant in ACTION_SYNONYMS) {
      if (Math.abs(word.length - variant.length) > 1) continue;
      if (levenshtein(word, variant) === 1) return ACTION_SYNONYMS[variant];
    }
  }
  return null;
}

export function explicitReplacementNeeded(tareaUp: string): boolean {
  if (!tareaUp) return false;

  // 1. Si contiene palabras de control, regulación, ajuste o mantenimiento,
  // pero NO contiene verbos explícitos de cambio/colocación.
  // Quitamos LUBRICAR, LUBRICACION, ENGRASE, ENGRASAR porque son tareas que consumen insumos reales (aceite/grasa)
  const controlVerbs = [
    'CONTROLAR', 'CONTROL', 'REVISAR', 'REVISION', 'CHEQUEAR', 'CHEQUEO',
    'REGULAR', 'REGULACION', 'AJUSTAR', 'AJUSTE', 'LIMPIAR', 'LIMPIEZA',
    'SOLDAR', 'REFORZAR', 'REPARAR', 'REPARACION', 'MEDIR', 'MEDICION'
  ];

  const hasControlVerb = controlVerbs.some(k => tareaUp.includes(k));

  const explicitActions = [
    'CAMBIAR', 'COLOCAR', 'INSTALAR', 'REEMPLAZAR', 'COLCAR', 'COLOCADO', 'COLOCAN', 'CAMBIAN'
  ];

  if (hasControlVerb) {
    const hasExplicitAction = explicitActions.some(k => tareaUp.includes(k));
    const hasActiveCambio = tareaUp.includes('CAMBIO') && !tareaUp.includes('DE CAMBIO') && !tareaUp.includes('DE CAMBIOS');
    const hasActiveColoco = tareaUp.includes('COLOCO') && !tareaUp.includes('DE COLOCO');
    
    if (!hasExplicitAction && !hasActiveCambio && !hasActiveColoco) {
      return false;
    }
  }

  // 2. Si no tiene verbos de control o pasó el filtro, validamos si tiene un tipo de acción válido,
  // descartando "CAMBIO/CAMBIOS" cuando vienen precedidos por "DE" (sustantivo de caja/palanca de cambios)
  const actionType = getActionType(tareaUp);
  if (actionType === null) return false;

  // Doble verificación: si la acción detectada es REEMPLAZO debido a la palabra CAMBIO/CAMBIOS
  // pero todas las apariciones de CAMBIO/CAMBIOS están precedidas por "DE", entonces lo ignoramos.
  const words = tareaUp.split(/[^A-Z]/).map(w => w.trim()).filter(Boolean);
  const hasCambio = words.includes('CAMBIO') || words.includes('CAMBIOS');
  if (hasCambio) {
    const hasOnlyNounCambios = words.every((word, idx) => {
      if (word === 'CAMBIO' || word === 'CAMBIOS') {
        return idx > 0 && words[idx - 1] === 'DE';
      }
      return true;
    });

    if (hasOnlyNounCambios && !explicitActions.some(k => tareaUp.includes(k)) && !tareaUp.includes('COLOCO')) {
      return false;
    }
  }

  return true;
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

export function matchMaterial(matDescUp: string, synonymPhrase: string, tareaUp?: string, activeParts?: Record<string, string[]>): boolean {
  const stopWords = new Set(['DE', 'DEL', 'CON', 'SIN', 'POR', 'PARA', 'LOS', 'LAS', 'UNA', 'UNO', 'UNOS', 'UNAS', 'ESTE', 'ESTA', 'COMO', 'MAS', 'QUE', 'DELA', 'Y', 'O', 'LA', 'EL']);
  const actionWords = new Set(['CAMBIAR', 'CAMBIO', 'CAMBIOS', 'COLOCAR', 'COLOCACION', 'INSTALAR', 'INSTALACION', 'REEMPLAZAR', 'REEMPLAZO', 'COLOCA', 'COLCAR', 'COLOCADO', 'COLOCAN', 'CAMBIAN', 'CAMBIANDO', 'COLOCANDO']);

  const phraseWords = synonymPhrase.split(/[^A-Z0-9]/).map(w => w.trim()).filter(w => w && !stopWords.has(w) && !actionWords.has(w));
  if (phraseWords.length === 0) return false;

  const matWords = matDescUp.split(/[^A-Z0-9]/).map(w => w.trim()).filter(w => w && !stopWords.has(w));

  const baseMatch = phraseWords.every(pWord => {
    return matWords.some(mWord => {
      if (mWord === pWord) return true;
      if (mWord === pWord + 'S') return true;
      if (mWord === pWord + 'ES') return true;
      // Soporte explícito para la abreviación frecuente de ACEITE como AC o AC.
      if ((pWord === 'AC' || pWord === 'AC.') && mWord === 'ACEITE') return true;
      return isFuzzyMatch(mWord, pWord);
    });
  });

  if (!baseMatch) return false;

  // Si se provee la tarea, validar concordancia de contexto
  if (tareaUp && activeParts) {
    const isNeumatico = synonymPhrase.includes('CUBIERTA') || synonymPhrase.includes('NEUMATICO') || synonymPhrase.includes('RODADO');
    if (!isNeumatico) {
      const CONTEXT_WORDS = new Set([
        'EJE', 'BALANCIN', 'MOTOR', 'CAJA', 'FRENO', 'DIRECCION', 'SUSPENSION', 'CABINA', 'ACOPLADO', 'RUEDA',
        'DIFERENCIAL', 'TRANSMISION', 'ESCAPE', 'EMBRAGUE', 'TURBO', 'INTERCOOLER', 'RADIADOR', 'CALEFACCION',
        'AIRE', 'AGUA', 'COMBUSTIBLE', 'ACEITE', 'GRASA', 'FILTRO', 'CORREA', 'ALTERNADOR', 'ARRANQUE', 'BATERIA',
        'VALVULA', 'TACO', 'LONA', 'SEMI', 'QUINTA', 'ACOPLE', 'RULEMAN', 'RODAMIENTO', 'RETEN', 'JUNTA', 'TERMOSTATO',
        'ESCOBILLA', 'ROTULA', 'CRUCETA', 'TENSOR', 'CERRADURA', 'BISAGRA', 'PARAGOLPE', 'GUARDABARRO', 'CADENA',
        'PINON', 'CORONA', 'COMPRESOR', 'BOCINA', 'FUSIBLE', 'DISCO', 'PASTILLA', 'ESPEJO', 'OPTICA', 'FARO', 'LAMPARA',
        'FOCO', 'LED', 'REFRIGERANTE'
      ]);

      for (const cat in activeParts) {
        CONTEXT_WORDS.add(up(cat));
        (activeParts[cat] || []).forEach(syn => {
          up(syn).split(/[^A-Z0-9]/).forEach(w => {
            const cleanW = w.trim();
            if (cleanW.length > 2 && !stopWords.has(cleanW) && !actionWords.has(cleanW)) {
              CONTEXT_WORDS.add(cleanW);
            }
          });
        });
      }

      const taskWords = tareaUp.split(/[^A-Z0-9]/).map(w => w.trim()).filter(w => w && !stopWords.has(w) && !actionWords.has(w));
      const taskContextWords = taskWords.filter(w => CONTEXT_WORDS.has(w));

      const matContextWords = matWords.filter(w => CONTEXT_WORDS.has(w));

      const phraseWordsSet = new Set(phraseWords);
      const cleanTaskContext = taskContextWords.filter(w => !phraseWordsSet.has(w));
      const cleanMatContext = matContextWords.filter(w => !phraseWordsSet.has(w));

      if (cleanTaskContext.length > 0 && cleanMatContext.length > 0) {
        const hasOverlap = cleanMatContext.some(mW => {
          return cleanTaskContext.some(tW => {
            if (mW === tW) return true;
            if (mW === tW + 'S' || mW === tW + 'ES') return true;
            return isFuzzyMatch(mW, tW);
          });
        });
        
        if (!hasOverlap) {
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * Set de verbos de acción a excluir cuando se buscan sinónimos de repuestos
 * dentro de una tarea (para que, p.ej., la palabra "ENGRASE" no se confunda
 * con el nombre de un repuesto). Se deriva de ACTION_SYNONYMS para mantener
 * una única fuente de verdad con getActionType().
 */
export const ACTION_WORDS = new Set(Object.keys(ACTION_SYNONYMS));

export function getMatchingCategories(tareaUp: string, activeParts: Record<string, string[]>): string[] {
  const matches: string[] = [];
  const stopWords = new Set(['DE', 'DEL', 'CON', 'SIN', 'POR', 'PARA', 'LOS', 'LAS', 'UNA', 'UNO', 'UNOS', 'UNAS', 'ESTE', 'ESTA', 'COMO', 'MAS', 'QUE', 'DELA', 'Y', 'O', 'LA', 'EL', 'EN', 'UN', 'AL', 'DI', 'SU']);
  const actionWords = ACTION_WORDS;
  
  const isValidSynonym = (syn: string) => {
    const s = syn.trim();
    if (!s) return false;
    if (s.includes(' ')) return true; // Las frases compuestas siempre son válidas (ej. "CAJA DE CAMBIO" es una frase válida)
    if (s.length < 2) return false;    // Descartar conectores de 1 sola letra (ej: 'y', 'o', 'a')
    if (stopWords.has(s)) return false; // Descartar stop-words comunes
    if (actionWords.has(s)) return false; // Descartar verbos de cambio genéricos (evita que "CAMBIO" sea un sinónimo válido por sí solo)
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
    // Soporte explícito para la abreviación frecuente de ACEITE como AC o AC.
    if ((taskWord === 'AC' || taskWord === 'AC.') && syn === 'ACEITE') return true;
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
    c1: number; c2: number; c3: number; c4: number;
    b1: MetricBreakdown; b2: MetricBreakdown; b3: MetricBreakdown; b4: MetricBreakdown;
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
  const orderReplacementCats: Record<string, Set<string>> = {};

  dfTar.forEach(row => {
    const tarea = row['Tarea'] === null || row['Tarea'] === undefined ? '' : String(row['Tarea']);
    const tareaUp = up(tarea);
    if (isInsumoOFerreteria(tareaUp)) return;
    if (!explicitReplacementNeeded(tareaUp)) return;

    const order = row['Nro. Orden']!;

    const matchedCategories = getMatchingCategories(tareaUp, activeParts);
    const orderStr = String(order);
    if (!orderReplacementCats[orderStr]) {
      orderReplacementCats[orderStr] = new Set();
    }
    matchedCategories.forEach(cat => {
      orderReplacementCats[orderStr].add(cat);
    });

    const matchesKnownCategory = matchedCategories.length > 0;
    if (!matchesKnownCategory) {
      const key = tareaUp;
      if (!unrecognizedMap[key]) unrecognizedMap[key] = { tarea, count: 0, order };
      unrecognizedMap[key].count++;
    }

    const mats = matByOrder[String(order)] || [];
    const matList = mats.filter(m => !isInsumoOFerreteria(up(m['Desc. Artículo'] || ''))).map(m => up(m['Desc. Artículo']));
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
        const found = matList.some(m => matsKws.some(mk => matchMaterial(m, up(mk), tareaUp, activeParts)));
        if (!found) missingCategories.push(cat);
      }

      // Validación de coherencia Tarea (acción) <-> Material.
      // Ej: una tarea de tipo LUBRICACION ("Engrase"/"Engrasar") debe tener
      // asociado un material de tipo grasa/lubricante/refrigerante; si el
      // material cargado es, en cambio, un repuesto físico (o viceversa),
      // se considera una desconexión aunque la categoría por sí sola matchee.
      const actionType = getActionType(tareaUp);
      let actionMismatch = false;
      if (actionType === 'LUBRICACION') {
        const lubricantFound = matList.some(m =>
          LUBRICANT_CATEGORIES.some(cat => (activeParts[cat] || []).some(kw => m.includes(up(kw))))
        );
        if (!lubricantFound) actionMismatch = true;
      }

      if (missingCategories.length > 0 || actionMismatch) {
        const motivos: string[] = [];
        if (missingCategories.length > 0) motivos.push(`Falta '${missingCategories.join("', '")}'`);
        if (actionMismatch) motivos.push(`Acción de lubricación ('${tarea}') sin material de tipo grasa/lubricante`);
        results.push({ ...base,
          'Tipo de Hallazgo': `2) Desconexión de material (${motivos.join('; ')})`,
          'Detalle': 'Materiales cargados no coinciden: ' + mats.map(m => String(m['Desc. Artículo'] || '')).join(', '),
        });
      }
    }
  });

  // Auditoría inversa: Repuestos cargados sin tarea asociada
  Object.keys(matByOrder).forEach(orderStr => {
    const mats = matByOrder[orderStr] || [];
    const issuedMats = mats.filter(m => {
      const v = parseFloat(String(m['Salidas']));
      return !isNaN(v) && v > 0;
    });
    if (issuedMats.length === 0) return;

    const taskCats = orderReplacementCats[orderStr] || new Set<string>();

    issuedMats.forEach(m => {
      const matDesc = String(m['Desc. Artículo'] || '');
      const matDescUp = up(matDesc);
      if (isInsumoOFerreteria(matDescUp)) return;

      // Encontrar a qué categorías del diccionario corresponde el material
      const matchedCatsByMat = Object.keys(activeParts).filter(cat => {
        const synonyms = activeParts[cat] || [];
        return synonyms.some(syn => matchMaterial(matDescUp, up(syn)));
      });

      // Si el material corresponde a alguna categoría auditada, pero ninguna de esas
      // categorías está cubierta por las tareas de la orden
      if (matchedCatsByMat.length > 0) {
        const hasTask = matchedCatsByMat.some(cat => taskCats.has(cat));
        if (!hasTask) {
          // Obtener datos de la orden si existen
          const ordData = ordByOrder[orderStr];
          
          // Buscar datos de equipo de las tareas si existen para esta orden
          let eqCode = String(m['Equipo'] || '');
          let eqName = String(m['Descripción'] || '');
          if (!eqCode || !eqName) {
            const taskRow = dfTar.find(t => String(t['Nro. Orden'] || t['DocNum'] || '') === orderStr);
            if (taskRow) {
              eqCode = eqCode || String(taskRow['Codigo equipo'] || '');
              eqName = eqName || String(taskRow['Nombre Equipo'] || '');
            }
          }

          results.push({
            'Nro. Orden': orderStr,
            'Equipo': eqCode,
            'Nombre Equipo': eqName,
            'Tarea': 'Sin tarea asociada',
            'Estado Tarea': 'Sin tarea',
            'Tipo de Hallazgo': '4) Repuesto sin Tarea registrada',
            'Detalle': `Se retiró el material '${matDesc}' (${m['Salidas']} unidades) pero no existe ninguna tarea de recambio en la orden que requiera esta categoría (${matchedCatsByMat.join(', ')}).`,
            ...(ordData ? {
              'Tipo de orden': ordData.tipoOrden || undefined,
              'Centros de costos': ordData.centrosCostos || undefined,
              'Contabilizada': ordData.contabilizada || undefined,
              'Fecha de la orden': ordData.fechaOrden || undefined,
              'Status de documento': ordData.statusDoc || undefined,
            } : {}),
          });
        }
      }
    });
  });

  const unrecognizedTasks = Object.values(unrecognizedMap).sort((a, b) => b.count - a.count);

  // Calculate metrics
  const r1 = results.filter(r => r['Tipo de Hallazgo'].startsWith('1)'));
  const r2 = results.filter(r => r['Tipo de Hallazgo'].startsWith('2)'));
  const r3 = results.filter(r => r['Tipo de Hallazgo'].startsWith('3)'));
  const r4 = results.filter(r => r['Tipo de Hallazgo'].startsWith('4)'));

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
      c1: r1.length, c2: r2.length, c3: r3.length, c4: r4.length,
      b1: calcBreakdown(r1, false),
      b2: calcBreakdown(r2, true),
      b3: calcBreakdown(r3, true),
      b4: calcBreakdown(r4, true),
    },
  };
}