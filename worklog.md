---
Task ID: 1
Agent: Main Agent
Task: Convertir Auditor_Mantenimiento.html en aplicación Next.js con diseño mejorado

Work Log:
- Analizó el HTML original (1120 líneas) para extraer toda la lógica de negocio
- Instaló dependencias: exceljs, papaparse, @types/papaparse
- Creó src/lib/audit-types.ts con interfaces TypeScript
- Creó src/lib/parts-dictionary.ts con el diccionario de 38 categorías de repuestos
- Creó src/lib/audit-engine.ts con la lógica de auditoría portada (runAudit, stripAccents, up, explicitReplacementNeeded, etc.)
- Creó src/components/auditor/AuditorApp.tsx como componente principal (~910 líneas) con:
  - FileUploader cards con diseño drag-style
  - MetricCard con breakdown (tareas, OM únicas, barras de almacén)
  - Tabla de resultados con ScrollArea y badges por tipo
  - Panel de IA Groq con selectores y análisis
  - Panel de aprendizaje con sugerencias editables
  - Gestión de diccionario aprendido (export/import/clear)
- Configuró globals.css con tema dark navy personalizado (oklch)
- Actualizó page.tsx como wrapper simple
- Corrigió error de lint (mutación de props en SuggestionCard)
- Verificó con ESLint (0 errores) y Agent Browser (sin errores de consola, responsive OK)

Stage Summary:
- Aplicación Next.js 16 funcional en http://localhost:3000
- Toda la lógica del HTML original preservada y mejorada
- Diseño profesional dark con shadcn/ui, Lucide icons, y Tailwind CSS 4
- Responsive verificado en desktop y mobile (768px)
