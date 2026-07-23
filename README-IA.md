# Configuración de IA y control de coherencia por OM

## 1. Variables de entorno (opcional, fallback de servidor)

La app permite que cada usuario configure su propia API Key desde la UI
("Configurar IA", se guarda en `localStorage` del navegador). Si además
querés fijar una key "de organización" para que la app funcione sin que el
usuario tenga que cargar nada, definí estas variables en tu `.env` /
entorno de despliegue (Vercel, Docker, etc.). El cliente sigue teniendo
prioridad: si el usuario cargó su propia key en la UI, se usa esa; si no,
se usa la del servidor.

```bash
# Groq (por defecto)
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx

# Xiaomi MiMo / MiLM
MIMO_API_KEY=xxxxxxxxxxxxxxxxxxxx
MIMO_BASE_URL=https://token-plan-sgp.xiaomimimo.com/v1   # opcional, este es el default

# Lightning.ai (proxy hacia otros modelos, incl. Claude)
LIGHTNING_API_KEY=xxxxxxxxxxxxxxxxxxxx
LIGHTNING_BASE_URL=https://lightning.ai/api/v1            # opcional, este es el default

# Ollama local (no requiere key)
OLLAMA_BASE_URL=http://localhost:11434/v1                 # opcional, este es el default
```

Estas variables las lee `src/app/api/ai/route.ts` (función
`getServerFallback`). El endpoint y el modelo específico (`model`) siguen
eligiéndose desde la UI (`Configurar IA`).

## 2. Módulo de Control Avanzado de Coherencia (IA por OM)

- **Servicio**: `src/lib/ai-coherence.ts`
  - `buildOMPayload(om, tareas, materiales)`: arma el JSON comprimido de la
    OM (tareas + materiales) que se envía a la IA.
  - `buildCoherencePrompt(payload)`: arma el prompt final incluyendo el
    system prompt (`COHERENCE_SYSTEM_PROMPT`) que fuerza la salida JSON.
  - `parseCoherenceResponse(raw)`: parsea de forma tolerante la respuesta
    del modelo (bloques ```json, tags `<think>`, comillas tipográficas,
    comas colgantes, etc.) y la normaliza a
    `{ coherente, discrepancia_detectada, sugerencia_control }`.
  - `requestOMCoherence(params)`: llama a `/api/ai` y devuelve el resultado
    ya parseado.
- **UI**: en `src/components/auditor/AuditorApp.tsx`, sección "Análisis de
  causa raíz con IA", botón **"Control de Coherencia IA"**. Al seleccionar
  una OM y presionarlo, se muestra una alerta visual verde (✅ Coherente) o
  roja (⚠️ Incoherente) con la discrepancia detectada y la sugerencia de
  control recomendada.

## 3. Corrección del cruce Tarea ↔ Material

- `src/lib/audit-engine.ts` ahora normaliza los verbos de acción de las
  tareas (`getActionType` / `ACTION_SYNONYMS`) agrupando variantes:
  - `CAMBIO` / `CAMBIAR` / `CAMBIA` / ... → `REEMPLAZO`
  - `COLOCO` / `COLOCAR` / `COLOCA` / ... → `COLOCACION`
  - `AGREGAR` / `AGREGO` / `RELLENAR` / ... → `AGREGADO`
  - `ENGRASE` / `ENGRASAR` / `ENGRASO` / ... → `LUBRICACION`
- Antes, `COLOCO` no era reconocida por el motor (la distancia de edición
  contra `COLOCAR` era 2, y el chequeo exigía distancia 1), así que esas
  tareas se ignoraban por completo. Ahora sí se detectan.
- Se agregó la categoría `GRASA` al diccionario de repuestos
  (`src/lib/parts-dictionary.ts`), que antes no existía, y se agregó una
  validación específica: una tarea de tipo `LUBRICACION` (Engrase) debe
  tener asociado un material de `LUBRICANT_CATEGORIES` (`GRASA`, `ACEITE`,
  `REFRIGERANTE`); si el material cargado es en cambio un repuesto físico,
  se marca como hallazgo `2) Desconexión de material`.
- El cruce sigue usando **`Nro. Orden` (OM)** como clave primaria (ver
  `matByOrder` en `runAudit`), tal como antes, pero ahora los materiales de
  cada OM se validan también contra el *tipo de acción* de la tarea, no
  solo contra la categoría de repuesto.

## 4. Pruebas

No se agregó un framework de testing (el proyecto no tenía ninguno
instalado y no hay `node_modules`), así que las pruebas son scripts
standalone ejecutables con [`tsx`](https://www.npmjs.com/package/tsx)
(no requieren instalar las dependencias del proyecto):

```bash
npx tsx tests/audit-engine.test.ts   # normalización de acciones + cruce por OM
npx tsx tests/ai-coherence.test.ts   # payload, prompt y parseo de la respuesta IA
```

Casos cubiertos:
- Normalización Cambio/Cambiar, Coloco/Colocar, Agregar, Engrase a la misma
  categoría lógica.
- Engrase + material de grasa → coherente (sin hallazgo).
- Engrase + repuesto físico → incoherente (hallazgo `2)`).
- Regresión del bug de "Coloco" (antes no se detectaba en absoluto).
- El cruce por OM no mezcla materiales de una orden con otra.
- Parseo tolerante de la respuesta JSON de la IA (con markdown, `<think>`,
  o JSON inválido).
