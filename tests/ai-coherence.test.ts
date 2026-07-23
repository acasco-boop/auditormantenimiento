/**
 * Pruebas de humo para el módulo de integración de IA (src/lib/ai-coherence.ts).
 * No requieren red ni API Key: solo validan el armado del payload/prompt y
 * el parseo tolerante de la respuesta del modelo.
 *
 * Correr con: npx tsx tests/ai-coherence.test.ts
 */
import assert from 'node:assert';
import { buildOMPayload, buildCoherencePrompt, parseCoherenceResponse } from '../src/lib/ai-coherence';
import type { MaterialRow } from '../src/lib/audit-types';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (e) {
    console.error(`❌ ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

test('buildOMPayload arma correctamente el JSON comprimido de la OM', () => {
  const materiales: MaterialRow[] = [
    { 'Desc. Artículo': 'GRASA EP2', 'Cant. planificada': 2, 'Salidas': 2, 'Almacen': 'PAÑOL' },
  ];
  const payload = buildOMPayload('OM-500', [{ tarea: 'ENGRASE GENERAL', estado: 'Cerrada' }], materiales);
  assert.strictEqual(payload.om, 'OM-500');
  assert.strictEqual(payload.tareas.length, 1);
  assert.strictEqual(payload.materiales[0].descripcion, 'GRASA EP2');
});

test('buildCoherencePrompt incluye el system prompt y el payload como JSON', () => {
  const payload = buildOMPayload('OM-501', [{ tarea: 'CAMBIO DE FILTRO' }], []);
  const prompt = buildCoherencePrompt(payload);
  assert.ok(prompt.includes('coherente'));
  assert.ok(prompt.includes('OM-501'));
  assert.ok(prompt.includes('"tarea":"CAMBIO DE FILTRO"') || prompt.includes('CAMBIO DE FILTRO'));
});

test('parseCoherenceResponse parsea un JSON limpio', () => {
  const raw = '{"coherente": true, "discrepancia_detectada": "", "sugerencia_control": ""}';
  const result = parseCoherenceResponse(raw);
  assert.strictEqual(result.coherente, true);
  assert.strictEqual(result.discrepancia_detectada, '');
});

test('parseCoherenceResponse tolera bloques ```json y texto extra alrededor', () => {
  const raw = 'Acá está el análisis:\n```json\n{"coherente": false, "discrepancia_detectada": "Falta grasa", "sugerencia_control": "Cargar grasa"}\n```\nFin.';
  const result = parseCoherenceResponse(raw);
  assert.strictEqual(result.coherente, false);
  assert.strictEqual(result.discrepancia_detectada, 'Falta grasa');
  assert.strictEqual(result.sugerencia_control, 'Cargar grasa');
});

test('parseCoherenceResponse tolera tags <think> de modelos razonadores', () => {
  const raw = '<think>analizando...</think>{"coherente": true, "discrepancia_detectada": "", "sugerencia_control": ""}';
  const result = parseCoherenceResponse(raw);
  assert.strictEqual(result.coherente, true);
});

test('parseCoherenceResponse devuelve un resultado seguro (no coherente) si el JSON es inválido', () => {
  const result = parseCoherenceResponse('esto no es JSON');
  assert.strictEqual(result.coherente, false);
  assert.ok(result.discrepancia_detectada.length > 0);
});

console.log(`\n${passed} pruebas pasaron correctamente.`);
