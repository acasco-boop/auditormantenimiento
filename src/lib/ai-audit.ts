import type {
  MaterialRow,
  AITaskVerdict,
  AIMaterialVerdict,
  AIOMResponse,
  AuditResult,
  PendingAITask,
  AIConfig,
} from './audit-types';
import { isInsumoOFerreteria, up } from './audit-engine';

export const AI_AUDIT_SYSTEM_PROMPT = `Sos un sistema experto de auditoría de mantenimiento de flotas de transporte pesado.
Tu trabajo es analizar la coherencia entre las tareas realizadas y los materiales/repuestos consumidos en una Orden de Mantenimiento (OM).

INSTRUCCIONES:
1. Para cada tarea, determiná:
   - La ACCIÓN (cambiar, colocar, engrase, agregar, reparar, etc.)
   - El OBJETO PRINCIPAL de la acción (qué se cambió/colocó/etc.)
   - El SISTEMA/UBICACIÓN (dónde se realizó - NO es un repuesto)

2. Según la acción:
   - CAMBIAR/REEMPLAZAR/SUSTITUIR: Debe existir un repuesto equivalente. Aceptar: nombre exacto, sinónimo, abreviatura, denominación comercial, nombre técnico, nombre SAP, subconjunto equivalente, diferencia singular/plural, error ortográfico razonable.
   - COLOCAR/INSTALAR: Debe existir una pieza funcionalmente asociada (no cualquier material).
   - ENGRASE/ENGRASAR/LUBRICAR: Solo buscar grasa/lubricante. NO exigir aceite Y refrigerante simultáneamente.
   - AGREGAR ACEITE: Solo buscar aceite compatible con el contexto (ej: Aceite 80W para diferencial).
   - REPARAR/AJUSTAR/REGULAR/REVISAR/DESARMAR/ARMAR/ACOMODAR/SOLDAR/REFORZAR/LIMPIAR: NO requieren repuesto nuevo obligatoriamente. Marcar como OK con requiere_material=false.

3. CRÍTICO - NO confundir SISTEMA/UBICACIÓN con REPUESTO:
   - "Agrego Aceite De Diferencial" → repuesto=ACEITE, sistema=DIFERENCIAL
   - "Cambiar Taco De Carroceria" → repuesto=TACO, sistema=CARROCERIA
   - "Cambiar Rotor De Vigia" → repuesto=ROTOR, sistema=VIGIA
   - "Cambio De Aceite De Motor Y Filtro Aceite" → repuestos=ACEITE+FILTRO, sistema=MOTOR

4. Analizar la FRASE COMPLETA, no solo sustantivos.

5. Revisar TODOS los materiales de la OM antes de decidir FALTA MATERIAL.

6. Aceptar equivalencias semánticas y funcionales:
   - Vidrio Espejo ≈ Cristal Espejo
   - Reloj De Cuenta Vuelta ≈ Cuenta Revoluciones ≈ Tacómetro
   - Soporte De Espejo ≈ Tirante De Sujeción De Espejo Retrovisor
   - Bomba Dosificadora De Adblue ≈ Válvula Dosificadora De Urea (AdBlue ≈ UREA)
   - Manija De Cierre Trincado ≈ Manija Cierre Cincado
   - Palanca Multifuncion ≈ Palanca Multi Funcion
   - Tambor De Arranque ≠ Motor De Arranque (son piezas distintas)

7. Para materiales huérfanos (sin tarea correspondiente):
   - Ignorar insumos de ferretería (tornillos, tuercas, arandelas, precintos, cinta, etc.)
   - Verificar si ALGUNA tarea de la OM justifica ese material

8. Prevención de falsos positivos - antes de marcar FALTA MATERIAL preguntate:
   1. ¿La tarea realmente obliga a consumir un material?
   2. ¿Identifiqué correctamente el objeto de la acción?
   3. ¿Estoy confundiendo sistema/ubicación con el repuesto?
   4. ¿Existe algún material equivalente aunque tenga otro nombre?
   5. ¿Existe una abreviatura o denominación SAP diferente?
   6. ¿El material puede ser un conjunto/subconjunto equivalente?
   7. ¿Analicé TODOS los materiales de la OM?
   8. ¿Lo estoy rechazando solo porque no coincide literalmente?
   9. ¿La tarea es reparación/ajuste/regulación y podría no requerir repuesto?

Respondé ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin markdown. Exactamente este formato:
{
  "tareas": [
    {
      "tarea": "texto original de la tarea",
      "resultado": "OK" o "FALTA MATERIAL",
      "requiere_material": true/false,
      "accion": "CAMBIAR/COLOCAR/ENGRASE/AGREGAR/REPARAR/etc",
      "objeto_principal": "qué se cambió",
      "sistema": "dónde/contexto",
      "material_encontrado": true/false,
      "descripcion_material": "descripción del material encontrado o null",
      "tipo_coincidencia": "exacta/sinonimo/equivalencia_semantica/denominacion_comercial/sin_coincidencia",
      "confianza": 0.0-1.0,
      "justificacion": "explicación breve en español"
    }
  ],
  "materiales_huerfanos": [
    {
      "descripcion": "descripción del material",
      "resultado": "SIN TAREA" o "JUSTIFICADO",
      "tarea_relacionada": "texto de la tarea que lo justifica o null",
      "confianza": 0.0-1.0,
      "justificacion": "explicación breve"
    }
  ]
}`;

export function buildOMAuditPayload(
  om: string,
  equipo: string,
  modelo: string,
  tareas: { tarea: string; estado: string }[],
  materiales: MaterialRow[]
): object {
  const filteredMaterials = materiales.filter(m => {
    const desc = up(String(m['Desc. Artículo'] || ''));
    const salidas = parseFloat(String(m['Salidas'] || '0'));
    return desc && !isNaN(salidas) && salidas > 0 && !isInsumoOFerreteria(desc);
  });

  return {
    om,
    equipo,
    modelo,
    tareas,
    materiales: filteredMaterials.map(m => ({
      codigo: String(m['Artículo'] || ''),
      descripcion: String(m['Desc. Artículo'] || ''),
      salidas: parseFloat(String(m['Salidas'] || '0')),
    })),
  };
}

export function parseAIAuditResponse(raw: string): AIOMResponse {
  let content = (raw || '').trim();
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '');
  content = content.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1');
  const fb = content.indexOf('{');
  const lb = content.lastIndexOf('}');
  if (fb !== -1 && lb > fb) content = content.substring(fb, lb + 1);
  content = content.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  content = content.replace(/,\s*([\]}])/g, '$1');

  try {
    const parsed = JSON.parse(content);
    return {
      tareas: Array.isArray(parsed.tareas) ? parsed.tareas : [],
      materiales_huerfanos: Array.isArray(parsed.materiales_huerfanos) ? parsed.materiales_huerfanos : [],
    };
  } catch {
    console.error('[AI Audit] Error parsing AI response');
    return { tareas: [], materiales_huerfanos: [] };
  }
}

export async function runAIAuditForOM(params: {
  om: string;
  equipo: string;
  modelo: string;
  tareas: { tarea: string; estado: string }[];
  materiales: MaterialRow[];
  aiConfig: AIConfig;
}): Promise<AIOMResponse> {
  const payload = buildOMAuditPayload(
    params.om, params.equipo, params.modelo, params.tareas, params.materiales
  );

  const prompt = `${AI_AUDIT_SYSTEM_PROMPT}\n\nDatos de la OM a auditar:\n${JSON.stringify(payload, null, 2)}`;

  const response = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      temperature: 0.1,
      max_tokens: 2000,
      apiKey: params.aiConfig.apiKey,
      model: params.aiConfig.model,
      provider: params.aiConfig.provider,
      baseUrl: params.aiConfig.baseUrl,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || 'Error al consultar la IA de auditoría.');
  }

  const content = data?.choices?.[0]?.message?.content || '';
  return parseAIAuditResponse(content);
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function runAIAudit(params: {
  pendingTasks: PendingAITask[];
  ordersToAudit: string[];
  matByOrder: Record<string, MaterialRow[]>;
  dfTar: { 'Nro. Orden'?: string | number | null; 'Tarea'?: string | null; 'Estado'?: string | null; 'Codigo equipo'?: string | null; 'Nombre Equipo'?: string | null; [key: string]: unknown }[];
  aiConfig: AIConfig;
  onProgress?: (current: number, total: number, om: string) => void;
}): Promise<AuditResult[]> {
  const { pendingTasks, ordersToAudit, matByOrder, dfTar, aiConfig, onProgress } = params;
  
  const uniqueOms = ordersToAudit;
  const auditResults: AuditResult[] = [];

  const pendingByOM = new Map<string, PendingAITask[]>();
  for (const pt of pendingTasks) {
    if (!pendingByOM.has(pt.orderStr)) pendingByOM.set(pt.orderStr, []);
    pendingByOM.get(pt.orderStr)!.push(pt);
  }

  for (let i = 0; i < uniqueOms.length; i++) {
    const omStr = uniqueOms[i];
    const materialesOM = matByOrder[omStr] || [];

    const ordTasks = dfTar.filter(t => String(t['Nro. Orden']) === omStr);
    const equipo = ordTasks.length > 0 ? String(ordTasks[0]['Codigo equipo'] || '') : '';
    const modelo = ordTasks.length > 0 ? String(ordTasks[0]['Nombre Equipo'] || '') : '';

    const allTareas = ordTasks
      .map(t => ({ tarea: String(t['Tarea'] || ''), estado: String(t['Estado'] || '') }))
      .filter(t => t.tarea);

    try {
      const iaRes = await runAIAuditForOM({
        om: omStr, equipo, modelo, tareas: allTareas, materiales: materialesOM, aiConfig,
      });

      const pendingForOM = pendingByOM.get(omStr) || [];
      // If we don't have pending tasks for this OM, we can't get ordData from them, but we can just use empty
      const firstPending = pendingForOM[0];
      const ordData = firstPending?.ordData;

      const baseOrdFields = ordData ? {
        'Tipo de orden': ordData.tipoOrden || undefined,
        'Centros de costos': ordData.centrosCostos || undefined,
        'Estado Orden': ordData.estadoOrden || undefined,
        'Contabilizada': ordData.contabilizada || undefined,
        'Fecha de la orden': ordData.fechaOrden || undefined,
        'Status de documento': ordData.statusDoc || undefined,
      } : {};

      for (const pt of pendingForOM) {
        const tv = iaRes.tareas.find((t: AITaskVerdict) =>
          t.tarea.toUpperCase().trim() === pt.tarea.toUpperCase().trim()
        );

        if (tv && tv.resultado === 'FALTA MATERIAL' && typeof tv.confianza === 'number' && tv.confianza >= 0.60) {
          const isHighConf = tv.confianza >= 0.85;
          auditResults.push({
            'Nro. Orden': omStr,
            'Equipo': pt.equipo,
            'Nombre Equipo': pt.nombreEquipo,
            'Tarea': pt.tarea,
            'Estado Tarea': pt.estadoTarea,
            'Tipo de Hallazgo': isHighConf ? '2) Falta material (IA)' : '2) Posible falta de material (IA - revisar)',
            'Detalle': tv.justificacion || `Acción: ${tv.accion || '?'}, Objeto: ${tv.objeto_principal || '?'}`,
            'Resultado IA': tv.resultado,
            'Material Relacionado': tv.descripcion_material || '',
            'Confianza IA': tv.confianza,
            'Justificación IA': tv.justificacion || '',
            ...baseOrdFields,
          });
        }
      }

      for (const mv of iaRes.materiales_huerfanos) {
        if (mv.resultado === 'SIN TAREA' && typeof mv.confianza === 'number' && mv.confianza >= 0.60) {
          auditResults.push({
            'Nro. Orden': omStr,
            'Equipo': equipo,
            'Nombre Equipo': modelo,
            'Tarea': 'Sin tarea asociada',
            'Estado Tarea': 'Sin tarea',
            'Tipo de Hallazgo': '4) Repuesto sin tarea (IA)',
            'Detalle': mv.justificacion || `Material "${mv.descripcion}" sin tarea que lo justifique`,
            'Resultado IA': mv.resultado,
            'Material Relacionado': mv.descripcion || '',
            'Confianza IA': mv.confianza,
            'Justificación IA': mv.justificacion || '',
            ...baseOrdFields,
          });
        }
      }
    } catch (err) {
      console.error(`[AI Audit] Error procesando OM ${omStr}:`, err);
    }

    if (onProgress) onProgress(i + 1, uniqueOms.length, omStr);
    if (i < uniqueOms.length - 1) await delay(150);
  }

  return auditResults;
}
