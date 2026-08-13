/**
 * Pruebas de humo para el motor de auditoría (src/lib/audit-engine.ts).
 *
 * Cómo correrlas (no requieren instalar dependencias del proyecto):
 *   npx tsx tests/audit-engine.test.ts
 *
 * Cubren:
 *  1. Normalización/lematización de verbos de acción (Cambio/Cambiar,
 *     Coloco/Colocar, Agregar, Engrase) -> misma categoría lógica.
 *  2. Cruce por OM: Tarea "Engrase" con material de grasa => coherente.
 *  3. Cruce por OM: Tarea "Engrase" con repuesto físico => incoherente
 *     (hallazgo tipo 2).
 *  4. Cruce por OM: Tarea "Coloco" (antes NO se detectaba) con el repuesto
 *     correcto => sin hallazgo (regresión del bug original).
 *  5. Caso feliz completo: mezcla de OMs coherentes e incoherentes.
 */
import assert from 'node:assert';
import {
  getActionType,
  explicitReplacementNeeded,
  runAudit,
  shouldExcludeOrderType,
} from '../src/lib/audit-engine';
import type { TareaRow, MaterialRow, OrdenRow } from '../src/lib/audit-types';

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

// ---------------------------------------------------------------------------
// 1. Normalización de verbos de acción
// ---------------------------------------------------------------------------
test('CAMBIO y CAMBIAR se normalizan a la misma categoría lógica (REEMPLAZO)', () => {
  assert.strictEqual(getActionType('CAMBIO DE FILTRO DE AIRE'), 'REEMPLAZO');
  assert.strictEqual(getActionType('CAMBIAR FILTRO DE AIRE'), 'REEMPLAZO');
});

test('COLOCO y COLOCAR se normalizan a la misma categoría lógica (COLOCACION)', () => {
  assert.strictEqual(getActionType('COLOCO RODAMIENTO RUEDA TRASERA'), 'COLOCACION');
  assert.strictEqual(getActionType('COLOCAR RODAMIENTO RUEDA TRASERA'), 'COLOCACION');
});

test('AGREGAR se reconoce como categoría AGREGADO', () => {
  assert.strictEqual(getActionType('AGREGAR ACEITE MOTOR'), 'AGREGADO');
});

test('ENGRASE / ENGRASAR se reconocen como categoría LUBRICACION', () => {
  assert.strictEqual(getActionType('ENGRASE GENERAL DE CHASIS'), 'LUBRICACION');
  assert.strictEqual(getActionType('ENGRASAR CRUCETA CARDAN'), 'LUBRICACION');
});

test('Una tarea sin verbo de acción reconocido no dispara cruce de materiales', () => {
  assert.strictEqual(getActionType('REVISAR NIVEL DE ACEITE'), null);
  assert.strictEqual(explicitReplacementNeeded('REVISAR NIVEL DE ACEITE'), false);
});

test('explicitReplacementNeeded ahora reconoce "COLOCO" (antes fallaba: distancia de edición 2 vs COLOCAR)', () => {
  assert.strictEqual(explicitReplacementNeeded('COLOCO AMORTIGUADOR DELANTERO'), true);
});

// ---------------------------------------------------------------------------
// Helpers para armar filas de prueba mínimas
// ---------------------------------------------------------------------------
function tarea(order: string, tareaTexto: string, extra: Partial<TareaRow> = {}): TareaRow {
  return {
    'DocNum': order,
    'Nro. Orden': order,
    'Codigo equipo': 'EQ-1',
    'Nombre Equipo': 'Camión 1',
    'Tarea': tareaTexto,
    'Estado': 'Cerrada',
    ...extra,
  };
}

function material(order: string, desc: string, salidas: number, extra: Partial<MaterialRow> = {}): MaterialRow {
  return {
    'Nro. OM': order,
    'Nro. Orden': order,
    'Desc. Artículo': desc,
    'Cant. planificada': salidas,
    'Salidas': salidas,
    'Almacen': 'PAÑOL CENTRAL',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// 2. Cruce por OM: Engrase + Grasa => coherente (sin hallazgo)
// ---------------------------------------------------------------------------
test('OM con tarea "Engrase" y material de grasa => SIN hallazgo (coherente)', () => {
  const dfTar = [tarea('OM-100', 'ENGRASE GENERAL DE CHASIS')];
  const dfMat = [material('OM-100', 'GRASA MULTIPROPOSITO EP2', 2)];
  const { results } = runAudit(dfTar, dfMat, {});
  const findings = results.filter(r => String(r['Nro. Orden']) === 'OM-100');
  assert.strictEqual(findings.length, 0, `No debería haber hallazgos, hubo: ${JSON.stringify(findings)}`);
});

// ---------------------------------------------------------------------------
// 3. Cruce por OM: Engrase + repuesto físico => incoherente (hallazgo 2)
// ---------------------------------------------------------------------------
test('OM con tarea "Engrase" pero material es un repuesto físico => hallazgo tipo 2 (incoherente)', () => {
  const dfTar = [tarea('OM-101', 'ENGRASE DE CRUCETA CARDAN')];
  const dfMat = [material('OM-101', 'RODAMIENTO 6205', 1)];
  const { results } = runAudit(dfTar, dfMat, {});
  const findings = results.filter(r => String(r['Nro. Orden']) === 'OM-101');
  assert.strictEqual(findings.length, 1, `Debería haber 1 hallazgo, hubo: ${findings.length}`);
  assert.ok(findings[0]['Tipo de Hallazgo'].startsWith('2)'), 'Debe ser hallazgo tipo 2 (desconexión de material)');
  assert.ok(findings[0]['Tipo de Hallazgo'].includes('lubricación'), 'El motivo debe mencionar la acción de lubricación');
});

// ---------------------------------------------------------------------------
// 4. Regresión del bug original: "Coloco" no se detectaba en absoluto
// ---------------------------------------------------------------------------
test('OM con tarea "Coloco" + repuesto correcto => SIN hallazgo (antes esta tarea se ignoraba por completo)', () => {
  const dfTar = [tarea('OM-102', 'COLOCO AMORTIGUADOR DELANTERO IZQUIERDO')];
  const dfMat = [material('OM-102', 'AMORTIGUADOR DELANTERO', 2)];
  const { results } = runAudit(dfTar, dfMat, {});
  const findings = results.filter(r => String(r['Nro. Orden']) === 'OM-102');
  assert.strictEqual(findings.length, 0);
});

test('OM con tarea "Coloco" SIN ningún material cargado => hallazgo tipo 1', () => {
  const dfTar = [tarea('OM-103', 'COLOCO FILTRO DE COMBUSTIBLE')];
  // Se incluye un material de OTRA orden para que el motor pueda inferir las
  // columnas del archivo; OM-103 sigue sin tener ningún material propio.
  const dfMat = [material('OM-999', 'FILTRO DE ACEITE', 1)];
  const { results } = runAudit(dfTar, dfMat, {});
  const findings = results.filter(r => String(r['Nro. Orden']) === 'OM-103');
  assert.strictEqual(findings.length, 1);
  assert.ok(findings[0]['Tipo de Hallazgo'].startsWith('1)'));
});

// ---------------------------------------------------------------------------
// 5. Caso mixto: varias OMs, cruce por Nro. de OM como clave primaria
// ---------------------------------------------------------------------------
test('El cruce usa el Nro. de OM como clave primaria (no se mezclan materiales entre órdenes distintas)', () => {
  const dfTar = [
    tarea('OM-200', 'CAMBIO DE PASTILLA DE FRENO'),
    tarea('OM-201', 'CAMBIO DE PASTILLA DE FRENO'),
  ];
  const dfMat = [
    material('OM-200', 'PASTILLA DE FRENO DELANTERA', 4),
    // OM-201 no tiene material de pastilla cargado -> debe generar hallazgo,
    // y NO debe "tomar prestado" el material de OM-200.
  ];
  const { results } = runAudit(dfTar, dfMat, {});
  const om200 = results.filter(r => String(r['Nro. Orden']) === 'OM-200');
  const om201 = results.filter(r => String(r['Nro. Orden']) === 'OM-201');
  assert.strictEqual(om200.length, 0, 'OM-200 tiene el material correcto, no debe tener hallazgos');
  assert.strictEqual(om201.length, 1, 'OM-201 no tiene material cargado, debe tener 1 hallazgo');
  assert.ok(om201[0]['Tipo de Hallazgo'].startsWith('1)'));
});

test('Agregar aceite con material de aceite cargado => sin hallazgo', () => {
  const dfTar = [tarea('OM-300', 'AGREGAR ACEITE DE MOTOR')];
  const dfMat = [material('OM-300', 'ACEITE 15W40', 5)];
  const { results } = runAudit(dfTar, dfMat, {});
  assert.strictEqual(results.filter(r => String(r['Nro. Orden']) === 'OM-300').length, 0);
});

// ---------------------------------------------------------------------------
// 6. Exclusión de tipos de orden Diagnóstico y Tercero
// ---------------------------------------------------------------------------
test('shouldExcludeOrderType excluye Diagnóstico', () => {
  assert.strictEqual(shouldExcludeOrderType('Diagnóstico'), true);
  assert.strictEqual(shouldExcludeOrderType('DIAGNOSTICO'), true);
  assert.strictEqual(shouldExcludeOrderType('Orden de Diagnóstico'), true);
});

test('shouldExcludeOrderType excluye Tercero', () => {
  assert.strictEqual(shouldExcludeOrderType('Tercero'), true);
  assert.strictEqual(shouldExcludeOrderType('TERCERO'), true);
  assert.strictEqual(shouldExcludeOrderType('Orden Tercero'), true);
});

test('shouldExcludeOrderType NO excluye otros tipos', () => {
  assert.strictEqual(shouldExcludeOrderType('Correctiva'), false);
  assert.strictEqual(shouldExcludeOrderType('Preventiva'), false);
  assert.strictEqual(shouldExcludeOrderType(''), false);
});

function orden(orderNum: string, tipoOrden: string, extra: Partial<OrdenRow> = {}): OrdenRow {
  return {
    'Nro. orden': orderNum,
    'Tipo de orden': tipoOrden,
    'Estado': 'Cerrada',
    'Contabilizada': 'No',
    ...extra,
  };
}

test('Órdenes de tipo Diagnóstico se excluyen de la auditoría', () => {
  const dfTar = [tarea('OM-DIAG', 'CAMBIO DE FILTRO DE AIRE')];
  const dfMat = [material('OM-DIAG', 'FILTRO DE AIRE', 1)];
  const dfOrd = [orden('OM-DIAG', 'Diagnóstico')];
  const { results } = runAudit(dfTar, dfMat, {}, dfOrd);
  const findings = results.filter(r => String(r['Nro. Orden']) === 'OM-DIAG');
  assert.strictEqual(findings.length, 0, `Órdenes de Diagnóstico no deberían generar hallazgos, hubo: ${findings.length}`);
});

test('Órdenes de tipo Tercero se excluyen de la auditoría', () => {
  const dfTar = [tarea('OM-TERC', 'CAMBIO DE CORREA')];
  const dfMat = [material('OM-TERC', 'CORREA DENTADA', 1)];
  const dfOrd = [orden('OM-TERC', 'Tercero')];
  const { results } = runAudit(dfTar, dfMat, {}, dfOrd);
  const findings = results.filter(r => String(r['Nro. Orden']) === 'OM-TERC');
  assert.strictEqual(findings.length, 0, `Órdenes de Tercero no deberían generar hallazgos, hubo: ${findings.length}`);
});

// ---------------------------------------------------------------------------
// 7. Materiales sin tarea (huérfanos) - Prueba de corrección
// ---------------------------------------------------------------------------
test('Material que no coincide con ninguna tarea => hallazgo tipo 4 (huérfano)', () => {
  const dfTar = [tarea('OM-ORPH', 'CAMBIO DE FILTRO DE ACEITE')];
  const dfMat = [
    material('OM-ORPH', 'FILTRO ACEITE', 1),
    material('OM-ORPH', 'CORREA DENTADA', 1),  // Este material no tiene tarea asociada
  ];
  const { results } = runAudit(dfTar, dfMat, {});
  const findings = results.filter(r => String(r['Nro. Orden']) === 'OM-ORPH');
  const orphanFindings = findings.filter(r => r['Detalle'] && r['Detalle'].includes('CORREA'));
  assert.strictEqual(orphanFindings.length, 1, `Debería detectar CORREA como huérfano, hallazgos: ${JSON.stringify(findings)}`);
  assert.ok(orphanFindings[0]['Tipo de Hallazgo'].startsWith('4)'), 'Debe ser hallazgo tipo 4');
});

// ---------------------------------------------------------------------------
// 8. Tarea de lubricación sin material de lubricante
// ---------------------------------------------------------------------------
test('Tarea de Engrase sin material de Grasa => hallazgo tipo 2', () => {
  const dfTar = [tarea('OM-LUB', 'ENGRASAR TRACTOR COMPLETO')];
  const dfMat = [
    material('OM-LUB', 'FILTRO DE ACEITE', 1),  // Material que NO es lubricante
  ];
  const { results } = runAudit(dfTar, dfMat, {});
  const findings = results.filter(r => String(r['Nro. Orden']) === 'OM-LUB');
  assert.strictEqual(findings.length, 1, `Debería generar hallazgo por falta de grasa, hallazgos: ${JSON.stringify(findings)}`);
  assert.ok(findings[0]['Tipo de Hallazgo'].startsWith('2)'), `Debe ser hallazgo tipo 2, fue: ${findings[0]['Tipo de Hallazgo']}`);
});

test('Tarea de Engrase CON material de Grasa => sin hallazgo', () => {
  const dfTar = [tarea('OM-LUB2', 'ENGRASAR CRUCETA CARDAN')];
  const dfMat = [
    material('OM-LUB2', 'GRASA MULTIPROPOSITO EP2', 2),
  ];
  const { results } = runAudit(dfTar, dfMat, {});
  const findings = results.filter(r => String(r['Nro. Orden']) === 'OM-LUB2');
  assert.strictEqual(findings.length, 0, `No debería generar hallazgo, hubo: ${JSON.stringify(findings)}`);
});

console.log(`\n${passed} pruebas pasaron correctamente.`);
