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

export const AI_AUDIT_SYSTEM_PROMPT = `Auditor de mantenimiento de flotas. Analizá coherencia Tarea-Material en OM.

REGLAS:
- CAMBIAR/REEMPLAZAR: buscar repuesto equivalente (sinónimo, abreviatura, error ortográfico OK)
- COLOCAR/INSTALAR: pieza funcional asociada
- ENGRASE/LUBRICAR: solo grasa/lubricante
- AGREGAR ACEITE: aceite compatible con contexto
- REPARAR/AJUSTAR/REVISAR/SOLDAR/LIMPIAR: NO requieren repuesto (OK, requiere_material=false)
- NO confundir SISTEMA con REPUESTO: "Aceite De Diferencial" → rep=ACEITE, sis=DIFERENCIAL
- Ignorar insumos ferretería (tornillos, tuercas, arandelas, precintos)
- Aceptar equivalencias: Vidrio≈Cristal, Reloj Cuenta Vuelta≈Tacómetro, AdBlue≈UREA

Si recibís un array de OMs, devolvé un array con el mismo orden. Si recibís una OM sola, devolvé un objeto.
JSON para una OM: {"om":"...","tareas":[...],"materiales_huerfanos":[...]}
JSON para lote: [{"om":"...","tareas":[...],"materiales_huerfanos":[...]},...]

Campos tarea: tarea, resultado(OK|FALTA MATERIAL), requiere_material(bool), accion, objeto_principal, sistema, material_encontrado(bool), descripcion_material, tipo_coincidencia(exacta|sinonimo|equivalencia|sin_coincidencia), confianza(0-1), justificacion
Campos material: descripcion, resultado(SIN TAREA|JUSTIFICADO), tarea_relacionada, confianza(0-1), justificacion`;

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
  
  const auditResults: AuditResult[] = [];

  const pendingByOM = new Map<string, PendingAITask[]>();
  for (const pt of pendingTasks) {
    if (!pendingByOM.has(pt.orderStr)) pendingByOM.set(pt.orderStr, []);
    pendingByOM.get(pt.orderStr)!.push(pt);
  }

  // Agrupar órdenes en lotes de 5 para reducir llamadas a la IA
  const BATCH_SIZE = 5;
  const batches: string[][] = [];
  for (let i = 0; i < ordersToAudit.length; i += BATCH_SIZE) {
    batches.push(ordersToAudit.slice(i, i + BATCH_SIZE));
  }

  let processedCount = 0;

  for (const batch of batches) {
    // Construir payload con múltiples órdenes
    const batchPayload: Array<{
      om: string;
      equipo: string;
      modelo: string;
      tareas: { tarea: string; estado: string }[];
      materiales: { codigo: string; descripcion: string; salidas: number }[];
    }> = [];

    for (const omStr of batch) {
      const materialesOM = matByOrder[omStr] || [];
      const ordTasks = dfTar.filter(t => String(t['Nro. Orden']) === omStr);
      const equipo = ordTasks.length > 0 ? String(ordTasks[0]['Codigo equipo'] || '') : '';
      const modelo = ordTasks.length > 0 ? String(ordTasks[0]['Nombre Equipo'] || '') : '';

      const allTareas = ordTasks
        .map(t => ({ tarea: String(t['Tarea'] || ''), estado: String(t['Estado'] || '') }))
        .filter(t => t.tarea);

      const filteredMaterials = materialesOM.filter(m => {
        const desc = up(String(m['Desc. Artículo'] || ''));
        const salidas = parseFloat(String(m['Salidas'] || '0'));
        return desc && !isNaN(salidas) && salidas > 0 && !isInsumoOFerreteria(desc);
      });

      batchPayload.push({
        om: omStr,
        equipo,
        modelo,
        tareas: allTareas,
        materiales: filteredMaterials.map(m => ({
          codigo: String(m['Artículo'] || ''),
          descripcion: String(m['Desc. Artículo'] || ''),
          salidas: parseFloat(String(m['Salidas'] || '0')),
        })),
      });
    }

    // Una sola llamada para el lote
    const prompt = `${AI_AUDIT_SYSTEM_PROMPT}\n\nLote de ${batch.length} OMs a auditar:\n${JSON.stringify(batchPayload, null, 2)}`;

    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          temperature: 0.1,
          max_tokens: 4000,
          apiKey: aiConfig.apiKey,
          model: aiConfig.model,
          provider: aiConfig.provider,
          baseUrl: aiConfig.baseUrl,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        console.error('[AI Audit] Error en lote:', data?.error);
        continue;
      }

      const content = data?.choices?.[0]?.message?.content || '';
      const parsed = parseBatchAIResponse(content);

      // Procesar resultados del lote
      for (const omResult of parsed) {
        const omStr = omResult.om;
        const pendingForOM = pendingByOM.get(omStr) || [];
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

        const ordTasks = dfTar.filter(t => String(t['Nro. Orden']) === omStr);
        const equipo = ordTasks.length > 0 ? String(ordTasks[0]['Codigo equipo'] || '') : '';
        const modelo = ordTasks.length > 0 ? String(ordTasks[0]['Nombre Equipo'] || '') : '';

        for (const tv of (omResult.tareas || [])) {
          const conf = parseFloat(String(tv?.confianza || '1'));
          if (tv.resultado === 'FALTA MATERIAL' && conf >= 0.60) {
            const originalTask = ordTasks.find(t => 
              String(t['Tarea'] || '').toUpperCase().trim() === tv.tarea.toUpperCase().trim()
            );
            const pendingTask = pendingForOM.find(pt => 
              pt.tarea.toUpperCase().trim() === tv.tarea.toUpperCase().trim()
            );
            
            const isHighConf = conf >= 0.85;
            auditResults.push({
              'Nro. Orden': omStr,
              'Equipo': pendingTask?.equipo || equipo,
              'Nombre Equipo': pendingTask?.nombreEquipo || modelo,
              'Tarea': tv.tarea,
              'Estado Tarea': pendingTask?.estadoTarea || String(originalTask?.['Estado'] || ''),
              'Tipo de Hallazgo': isHighConf ? '2) Falta material (IA)' : '2) Posible falta de material (IA - revisar)',
              'Detalle': tv.justificacion || `Acción: ${tv.accion || '?'}, Objeto: ${tv.objeto_principal || '?'}`,
              'Resultado IA': tv.resultado,
              'Material Relacionado': tv.descripcion_material || '',
              'Confianza IA': conf,
              'Justificación IA': tv.justificacion || '',
              ...baseOrdFields,
            });
          }
        }

        for (const mv of (omResult.materiales_huerfanos || [])) {
          const conf2 = parseFloat(String(mv?.confianza || '1'));
          if (mv.resultado === 'SIN TAREA' && conf2 >= 0.60) {
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
              'Confianza IA': conf2,
              'Justificación IA': mv.justificacion || '',
              ...baseOrdFields,
            });
          }
        }

        processedCount++;
        if (onProgress) onProgress(processedCount, ordersToAudit.length, omStr);
      }

    } catch (err) {
      console.error('[AI Audit] Error procesando lote:', err);
    }

    // Delay entre lotes (no entre órdenes individuales)
    if (batches.indexOf(batch) < batches.length - 1) {
      await delay(300);
    }
  }

  return auditResults;
}

// Parsear respuesta de múltiples OMs
function parseBatchAIResponse(raw: string): Array<{
  om: string;
  tareas: AITaskVerdict[];
  materiales_huerfanos: AIMaterialVerdict[];
}> {
  let content = (raw || '').trim();
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '');
  content = content.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1');
  
  // Detectar si es array u objeto
  const firstBracket = content.indexOf('[');
  const firstBrace = content.indexOf('{');
  const lastBracket = content.lastIndexOf(']');
  const lastBrace = content.lastIndexOf('}');
  
  if (firstBracket !== -1 && lastBracket > firstBracket && (firstBracket < firstBrace || firstBrace === -1)) {
    content = content.substring(firstBracket, lastBracket + 1);
  } else if (firstBrace !== -1 && lastBrace > firstBrace) {
    content = content.substring(firstBrace, lastBrace + 1);
  }
  
  content = content.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  content = content.replace(/,\s*([\]}])/g, '$1');

  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed.map(item => ({
        om: String(item.om || ''),
        tareas: Array.isArray(item.tareas) ? item.tareas : [],
        materiales_huerfanos: Array.isArray(item.materiales_huerfanos) ? item.materiales_huerfanos : [],
      }));
    }
    return [{
      om: String(parsed.om || ''),
      tareas: Array.isArray(parsed.tareas) ? parsed.tareas : [],
      materiales_huerfanos: Array.isArray(parsed.materiales_huerfanos) ? parsed.materiales_huerfanos : [],
    }];
  } catch {
    console.error('[AI Audit] Error parsing batch response');
    return [];
  }
}
