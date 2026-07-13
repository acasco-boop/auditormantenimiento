export interface TareaRow {
  'Codigo equipo'?: string | null;
  'Nombre Equipo'?: string | null;
  'DocNum'?: string | number | null;
  'Orden de venta'?: string | number | null;
  'Estado'?: string | null;
  'Id Tarea'?: string | number | null;
  'Codigo tarea'?: string | number | null;
  'Tarea'?: string | null;
  'Codigo empleado'?: string | number | null;
  'Nombre empleado'?: string | null;
  'Fecha inicio'?: string | Date | null;
  'hora inicio'?: string | null;
  'Fecha termino'?: string | Date | null;
  'Hora termino'?: string | null;
  'Horas trabajadas'?: string | number | null;
  'Tiempo muerto (minutos)'?: string | number | null;
  'Nro. Orden'?: string | number | null;
  [key: string]: unknown;
}

export interface MaterialRow {
  'Equipo'?: string | null;
  'Descripción'?: string | null;
  'Nro. OM'?: string | number | null;
  'Estado'?: string | null;
  'Fecha OM'?: string | Date | null;
  'ID Mateiales'?: string | number | null;
  'Artículo'?: string | null;
  'Desc. Artículo'?: string | null;
  'Almacen'?: string | null;
  'Cant. planificada'?: string | number | null;
  'Salidas'?: string | number | null;
  'Devoluciones'?: string | number | null;
  'Cant. utilizada'?: string | number | null;
  'Nro. Orden'?: string | number | null;
  [key: string]: unknown;
}

export interface AuditResult {
  'Nro. Orden': string | number;
  'Equipo': string;
  'Nombre Equipo': string;
  'Tarea': string;
  'Estado Tarea': string;
  'Tipo de Hallazgo': string;
  'Detalle': string;
}

export interface UnrecognizedTask {
  tarea: string;
  count: number;
  order: string | number;
}

export interface MetricBreakdown {
  taskCount: number;
  uniqueOMs: number;
  warehouses: { name: string; count: number }[];
}

export interface AISuggestion {
  tarea: string;
  categoria: string | null;
  sinonimos: string[];
}