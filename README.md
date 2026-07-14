# Auditor de Mantenimiento

Una aplicación web desarrollada en Next.js para auditar y analizar inconsistencias en órdenes de trabajo y gestión de pañol para flotas de transporte. 
Incorpora Inteligencia Artificial para el análisis de fallas y cruces de información de repuestos huérfanos.

## Características

- **Análisis de Órdenes de Trabajo:** Importación y visualización de excels de tareas, materiales y órdenes.
- **Auditoría Inteligente (IA):** Identifica causas raíz, riesgos y acciones correctivas directamente sobre las órdenes usando IA.
- **Cruce de Repuestos (OV):** Compara los elementos sin stock con el diccionario y utiliza IA para sugerir coincidencias probables (fuzzy match).

## Tecnologías Utilizadas

- [Next.js](https://nextjs.org/) (App Router)
- React
- Tailwind CSS
- Componentes UI (Shadcn / Radix UI)
- Integración con API de IA (Lightning AI)

## Desarrollo Local

Para correr el servidor de desarrollo localmente:

```bash
# Instalar dependencias (si aplica)
npm install

# Correr el servidor
npm run dev
# o
bun dev
```

La aplicación estará disponible en `http://localhost:3000`.

## Configuración de IA

El proyecto utiliza un endpoint interno (`/api/ai`) para comunicarse de forma segura con la API de IA (Lightning AI) sin exponer la API Key en el frontend.

---

**Nota sobre Despliegue:** 
Debido a que este proyecto ahora cuenta con una ruta de API en el backend (`/api/ai`) para proteger tus credenciales, requiere un servidor Node.js para funcionar al 100%. Las plataformas de alojamiento estático (como GitHub Pages) **no soportan** rutas de API. Se recomienda desplegar en Vercel, Netlify o un VPS.
