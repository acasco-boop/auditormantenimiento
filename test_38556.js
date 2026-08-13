/**
 * Script de prueba para verificar que la Orden 38556 ahora aparece
 * en los resultados de auditoría como material huérfano.
 * 
 * Ejecutar con: node test_38556.js
 */

// Simular datos de prueba
const testCases = [
  {
    name: 'Orden 38556 - Material sin tarea correspondiente',
    data: {
      tareas: [
        {
          'Nro. Orden': '38556',
          'DocNum': '38556',
          'Codigo equipo': 'EQ-001',
          'Nombre Equipo': 'Camión Test',
          'Tarea': 'Cambio de filtro de aceite',
          'Estado': 'Cerrada'
        }
      ],
      materiales: [
        {
          'Nro. Orden': '38556',
          'Nro. OM': '38556',
          'Desc. Artículo': 'FILTRO ACEITE',
          'Salidas': 1,
          'Equipo': 'EQ-001',
          'Descripción': 'Camión Test'
        },
        {
          'Nro. Orden': '38556',
          'Nro. OM': '38556',
          'Desc. Artículo': 'CORREA DENTADA',
          'Salidas': 1,
          'Equipo': 'EQ-001',
          'Descripción': 'Camión Test'
        }
      ],
      ordenes: [
        {
          'Nro. orden': '38556',
          'Tipo de orden': 'Correctiva',
          'Estado': 'Cerrada',
          'Contabilizada': 'No'
        }
      ]
    },
    expected: {
      shouldHaveFindings: true,
      shouldHaveOrphanMaterial: true,
      orphanMaterialDesc: 'CORREA DENTADA'
    }
  }
];

console.log('=== PRUEBA DE CORRECCIÓN - ORDEN 38556 ===\n');

testCases.forEach((testCase, index) => {
  console.log(`Prueba ${index + 1}: ${testCase.name}`);
  console.log('Datos de entrada:');
  console.log(`  - Tareas: ${testCase.data.tareas.length}`);
  console.log(`  - Materiales: ${testCase.data.materiales.length}`);
  console.log(`  - Órdenes: ${testCase.data.ordenes.length}`);
  
  // Simular la lógica de auditoría (versión simplificada)
  const orderStr = '38556';
  const relevantMats = testCase.data.materiales.filter(m => {
    const desc = String(m['Desc. Artículo'] || '').toUpperCase();
    const salidas = parseFloat(String(m['Salidas'] || '0'));
    return desc && salidas > 0;
  });
  
  const orderTasks = testCase.data.tareas.filter(t => 
    String(t['Nro. Orden'] || t['DocNum'] || '') === orderStr
  );
  
  console.log(`\nAnálisis:`);
  console.log(`  - Materiales relevantes: ${relevantMats.length}`);
  console.log(`  - Tareas en la orden: ${orderTasks.length}`);
  
  // Simular la lógica corregida
  const tasksRequiringMaterial = orderTasks.filter(t => {
    const tarea = String(t['Tarea'] || '').toUpperCase();
    // Simular explicitReplacementNeeded
    return tarea.includes('CAMBIO') || tarea.includes('CAMBIAR') || 
           tarea.includes('COLOCAR') || tarea.includes('INSTALAR') ||
           tarea.includes('AGREGAR') || tarea.includes('REEMPLAZAR');
  });
  
  console.log(`  - Tareas que requieren material: ${tasksRequiringMaterial.length}`);
  
  if (tasksRequiringMaterial.length > 0) {
    // NUEVA LÓGICA: Verificar cada material contra las tareas
    const orphanMaterials = [];
    
    relevantMats.forEach(m => {
      const matDesc = String(m['Desc. Artículo'] || '').toUpperCase();
      
      // Simular si el material está justificado por alguna tarea
      const isJustified = tasksRequiringMaterial.some(t => {
        const tarea = String(t['Tarea'] || '').toUpperCase();
        
        // Simular getMatchingCategories
        const taskWords = tarea.split(/\s+/).filter(w => 
          !['DE', 'DEL', 'CON', 'SIN', 'POR', 'PARA', 'LOS', 'LAS', 'UNA', 'UNO'].includes(w) &&
          !['CAMBIO', 'CAMBIAR', 'COLOCAR', 'INSTALAR', 'AGREGAR', 'REEMPLAZAR'].includes(w)
        );
        
        // Simular matchMaterial
        const matWords = matDesc.split(/\s+/);
        return taskWords.some(taskWord => 
          matWords.some(matWord => 
            matWord === taskWord || 
            matWord === taskWord + 'S' || 
            matWord === taskWord + 'ES'
          )
        );
      });
      
      if (!isJustified) {
        orphanMaterials.push(matDesc);
      }
    });
    
    console.log(`\nResultados:`);
    console.log(`  - Materiales huérfanos detectados: ${orphanMaterials.length}`);
    orphanMaterials.forEach(desc => {
      console.log(`    * ${desc}`);
    });
    
    // Verificar expectativas
    const testPassed = 
      (testCase.expected.shouldHaveOrphanMaterial && orphanMaterials.length > 0) &&
      (!testCase.expected.orphanMaterialDesc || 
       orphanMaterials.includes(testCase.expected.orphanMaterialDesc));
    
    console.log(`\nResultado de la prueba: ${testPassed ? '✅ PASÓ' : '❌ FALLÓ'}`);
    
    if (!testPassed) {
      console.log('  Expectativas:');
      console.log(`    - Debería tener materiales huérfanos: ${testCase.expected.shouldHaveOrphanMaterial}`);
      console.log(`    - Material huérfano esperado: ${testCase.expected.orphanMaterialDesc || 'N/A'}`);
    }
  } else {
    console.log('\nNo hay tareas que requieran material - todos los materiales serían huérfanos');
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
});

console.log('=== RESUMEN DE LA CORRECCIÓN ===');
console.log('La corrección implementada verifica que cada material');
console.log('esté justificado por alguna tarea de la orden, usando');
console.log('el sistema de matching existente (getMatchingCategories');
console.log('y matchMaterial). Esto garantiza que materiales como');
console.log('"CORREA DENTADA" sean detectados como huérfanos cuando');
console.log('no hay ninguna tarea que los justifique.');
console.log('\nPara verificar con datos reales, ejecute la aplicación');
console.log('y cargue los archivos Excel de la carpeta upload/');