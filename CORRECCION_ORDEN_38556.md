# Corrección: Detección de Materiales Huérfanos (Orden 38556)

## Problema Identificado

La Orden 38556 no aparecía en los resultados de auditoría a pesar de tener materiales sin su tarea respectiva.

### Causa Raíz

El bug estaba en la sección "Auditoría: Materiales sin tarea" del archivo `src/lib/audit-engine.ts` (líneas 632-717).

**Lógica anterior (incorrecta):**
1. Filtraba materiales relevantes (con salidas > 0, no insumos)
2. Si no había tareas en la orden, marcaba todos los materiales como huérfanos
3. Si había tareas, buscaba tareas que requieran material
4. **Si había tareas que requerían material, NO hacía nada más**

**Problema:** Esta lógica asumía que si existía alguna tarea que requería material, entonces TODOS los materiales estaban bien asignados. Esto es incorrecto porque:
- Una orden puede tener múltiples tareas y múltiples materiales
- Un material puede no coincidir con ninguna tarea específica
- Ejemplo: Tarea "Cambio de filtro" + Materiales ["FILTRO ACEITE", "CORREA DENTADA"]
  - "FILTRO ACEITE" está justificado por la tarea
  - "CORREA DENTADA" NO está justificado por ninguna tarea

## Corrección Implementada

Se modificó la lógica para que **verifique cada material contra las tareas de la orden**:

```typescript
// NUEVA LÓGICA: Verificar cada material contra las tareas de la orden
// Para cada material, verificar si hay alguna tarea que lo justifique
relevantMats.forEach(m => {
  const matDescUp = up(String(m['Desc. Artículo'] || ''));
  const salidas = parseFloat(String(m['Salidas'] || '0'));
  
  // Verificar si este material está justificado por alguna tarea
  const isJustified = tasksRequiringMaterial.some(t => {
    const tarea = String(t['Tarea'] || '');
    const tareaUp = up(tarea);
    
    // Obtener las categorías que coinciden con esta tarea
    const matchedCategories = getMatchingCategories(tareaUp, activeParts);
    
    // Verificar si el material coincide con alguna categoría de la tarea
    return matchedCategories.some(cat => {
      // Obtener los sinónimos de esta categoría
      const synonyms = activeParts[cat] || [];
      const allSynonyms = [cat, ...synonyms];
      
      // Verificar si el material coincide con algún sinónimo
      return allSynonyms.some(syn => {
        const synUp = up(syn);
        return matchMaterial(matDescUp, synUp, tareaUp, activeParts);
      });
    });
  });
  
  // Si el material no está justificado por ninguna tarea, marcarlo como huérfano
  if (!isJustified) {
    // ... agregar a resultados como hallazgo tipo 4
  }
});
```

### Cambios Realizados

1. **Archivo modificado:** `src/lib/audit-engine.ts`
2. **Sección:** "Auditoría: Materiales sin tarea" (líneas ~632-750)
3. **Cambio principal:** Se agregó verificación de cada material contra las tareas usando:
   - `getMatchingCategories()`: Para obtener las categorías que coinciden con cada tarea
   - `matchMaterial()`: Para verificar si un material coincide con alguna categoría

## Cómo Verificar la Corrección

### Opción 1: Ejecutar la aplicación
1. Inicie la aplicación con `npm run dev` o `bun dev`
2. Cargue los archivos Excel de la carpeta `upload/`:
   - `Tarea.xlsx`
   - `Material.xlsx`
   - `Ordenes.xlsx`
3. Verifique que la Orden 38556 ahora aparece en los resultados

### Opción 2: Ejecutar script de prueba
```bash
node test_38556.js
```

### Opción 3: Verificar manualmente
Revise que en los resultados de auditoría aparezca:
- **Orden:** 38556
- **Tipo de Hallazgo:** "4) Repuesto sin tarea (IA)"
- **Detalle:** Material que no coincide con ninguna tarea de la orden

## Archivos Creados

1. `test_38556.js` - Script de prueba para verificar la corrección
2. `CORRECCION_ORDEN_38556.md` - Este archivo de documentación

## Próximos Pasos

1. **Verificar con datos reales** usando los archivos Excel en `upload/`
2. **Ejecutar pruebas unitarias** existentes para asegurar que no se rompieron otras funcionalidades
3. **Monitorear** el rendimiento con órdenes grandes (muchos materiales y tareas)