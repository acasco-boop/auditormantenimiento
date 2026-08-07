/**
 * Módulo de integración de IA para "Control Avanzado" de coherencia entre
 * Tareas y Materiales por Orden de Mantenimiento (OM).
 *
 * Este módulo arma un payload comprimido por OM (tareas + materiales),
 * lo envía a la ruta interna `/api/ai` (que a su vez habla con el proveedor
 * configurado: Groq, MiMo/Xiaomi MiLM, Lightning.ai u Ollama local) usando
 * un system prompt que fuerza una respuesta JSON estructurada, y parsea esa
 * respuesta de forma tolerante a errores de formato del modelo.
 *
 * La API Key y el modelo NUNCA se hardcodean acá: se reciben como parámetro
 * desde la configuración de la app (ver AuditorApp.tsx / variables de
 * entorno documentadas en README-IA.md).
 */

import type { MaterialRow } from './audit-types';

export interface CoherenceCheckResult {
  coherente: boolean;
  discrepancia_detectada: string;
  sugerencia_control: string;
}

export interface OMPayload {
  om: string;
  tareas: { tarea: string; estado: string }[];
  materiales: {
    descripcion: string;
    cantidad_planificada: string | number | null;
    salidas: string | number | null;
    almacen: string;
  }[];
}

/**
 * System prompt: define el contrato de salida que debe cumplir la IA.
 * Se mantiene fuera de la función para poder testearlo/editarlo fácilmente.
 */
export const COHERENCE_SYSTEM_PROMPT = `Sos un sistema de control de calidad para auditoría de mantenimiento de flotas de transporte pesado.
Vas a recibir, para UNA Orden de Mantenimiento (OM), la lista de tareas realizadas por el taller y la lista de materiales/repuestos consumidos según el pañol.
Tu trabajo es evaluar si existe COHERENCIA entre lo que dicen las tareas y lo que efectivamente se consumió de materiales. Por ejemplo:
- Una tarea de "Engrase"/"Engrasar" debería tener asociado un material de tipo grasa o lubricante (no un repuesto físico).
- Una tarea de "Cambio"/"Cambiar"/"Colocar" de una pieza debería tener asociado un repuesto físico de esa familia (no simplemente un insumo genérico).
- Si una tarea no tiene ningún material asociado, o el material asociado no corresponde en absoluto al tipo de trabajo descripto, es una discrepancia.
- IMPORTANTE (Cruce exacto de palabras de contexto): Debés verificar que TODAS las palabras descriptivas y de contexto de la tarea (ignorando verbos de acción y conectores) estén presentes en la descripción del material de pañol. Por ejemplo:
  * Si la tarea es "Cambiar cubierta de Eje Balancín" y el material cargado es "Cubierta Taco", esto es una DISCREPANCIA (no coherente) porque falta la palabra "Balancín" en el material, y se trata de piezas completamente distintas.
  * Si la tarea es "Cambiar correa de alternador" y el material cargado es "Correa de ventilador", es una DISCREPANCIA (no coherente).
  * Exigí que cada palabra determinante de contexto coincida (salvo en neumáticos/cubiertas, donde basta con que sea el insumo genérico) para dar por válida la OM.

Respondé ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin explicaciones, sin markdown, con EXACTAMENTE este formato:
{"coherente": boolean, "discrepancia_detectada": "string", "sugerencia_control": "string"}

Reglas de contenido:
- "coherente": true si las tareas y los materiales de esta OM son consistentes entre sí; false si hay algún desvío o cruce erróneo de contexto relevante.
- "discrepancia_detectada": si coherente es false, describí en máximo 2 renglones y en español de Argentina cuál es la inconsistencia puntual (ej: "Cubierta Taco cargada para cambio de cubierta de eje balancín"). Si coherente es true, devolvé un string vacío "".
- "sugerencia_control": una acción correctiva breve y concreta que debería tomar el supervisor de taller o el encargado de pañol. Si coherente es true y no hay nada para sugerir, devolvé un string vacío "".`;

/** Arma el payload JSON comprimido de una OM a partir de las tareas y materiales crudos. */
export function buildOMPayload(
  om: string,
  tareas: { tarea: string; estado?: string }[],
  materiales: MaterialRow[]
): OMPayload {
  return {
    om,
    tareas: tareas.map(t => ({ tarea: t.tarea, estado: t.estado || '' })),
    materiales: materiales.map(m => ({
      descripcion: String(m['Desc. Artículo'] || ''),
      cantidad_planificada: (m['Cant. planificada'] as string | number | null) ?? null,
      salidas: (m['Salidas'] as string | number | null) ?? null,
      almacen: String(m['Almacen'] || ''),
    })),
  };
}

/** Arma el prompt completo (system prompt + payload de la OM) a enviar a la IA. */
export function buildCoherencePrompt(payload: OMPayload): string {
  return `${COHERENCE_SYSTEM_PROMPT}\n\nDatos de la Orden de Mantenimiento a evaluar (JSON comprimido):\n${JSON.stringify(payload)}`;
}

/**
 * Parsea de forma tolerante la respuesta cruda del modelo (que puede venir
 * con bloques ```json, tags <think>, comillas tipográficas, comas colgantes,
 * etc.) y la normaliza al contrato CoherenceCheckResult.
 */
export function parseCoherenceResponse(raw: string): CoherenceCheckResult {
  let text = (raw || '').trim();
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  text = text.replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '').trim();
  const fb = text.indexOf('{');
  const lb = text.lastIndexOf('}');
  if (fb !== -1 && lb > fb) text = text.substring(fb, lb + 1);
  text = text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/,\s*}/g, '}');

  try {
    const parsed = JSON.parse(text);
    return {
      coherente: Boolean(parsed.coherente),
      discrepancia_detectada: String(parsed.discrepancia_detectada || ''),
      sugerencia_control: String(parsed.sugerencia_control || ''),
    };
  } catch {
    return {
      coherente: false,
      discrepancia_detectada: 'No se pudo interpretar la respuesta de la IA (formato inválido).',
      sugerencia_control: 'Reintentar el análisis o revisar manualmente esta orden.',
    };
  }
}

export interface RequestOMCoherenceParams {
  order: string;
  tareas: { tarea: string; estado?: string }[];
  materiales: MaterialRow[];
  apiKey: string;
  model: string;
  provider: string;
  baseUrl: string;
}

/**
 * Llama a la ruta interna /api/ai con el payload de la OM y devuelve el
 * resultado de coherencia ya parseado. Lanza un Error con mensaje legible
 * si la llamada falla (API Key inválida, proveedor caído, etc.).
 */
export async function requestOMCoherence(params: RequestOMCoherenceParams): Promise<CoherenceCheckResult> {
  const payload = buildOMPayload(params.order, params.tareas, params.materiales);
  const prompt = buildCoherencePrompt(payload);

  const resp = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      temperature: 0.1,
      max_tokens: 500,
      apiKey: params.apiKey,
      model: params.model,
      provider: params.provider,
      baseUrl: params.baseUrl,
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data?.error || 'Error al consultar la IA de control de coherencia.');
  }

  const content = data?.choices?.[0]?.message?.content || '';
  return parseCoherenceResponse(content);
}
