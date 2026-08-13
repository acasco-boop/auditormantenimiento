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

export interface OrdenRow {
  'Nro. orden'?: string | number | null;
  'Tipo de orden'?: string | null;
  'Centos de costos'?: string | null;
  'Estado'?: string | null;
  'Codigo de equipo'?: string | null;
  'Nombre equipo'?: string | null;
  [key: string]: unknown;
}

export interface MaterialRow {
  'Equipo'?: string | null;
  'Descripcion'?: string | null;
  'Nro. OM'?: string | number | null;
  'Estado'?: string | null;
  'Fecha OM'?: string | Date | null;
  'ID Mateiales'?: string | number | null;
  'Articulo'?: string | null;
  'Desc. Articulo'?: string | null;
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
  'Resultado IA'?: string;
  'Material Relacionado'?: string;
  'Confianza IA'?: number;
  'Justificacion IA'?: string;
  'Tipo de orden'?: string;
  'Centros de costos'?: string;
  'Estado Orden'?: string;
  'Contabilizada'?: string;
  'Fecha de la orden'?: string;
  'Status de documento'?: string;
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
  tiposOrden: { name: string; count: number }[];
}

export interface AISuggestion {
  tarea: string;
  categoria: string | null;
  sinonimos: string[];
}

export interface AITaskVerdict {
  tarea: string;
  resultado: 'OK' | 'FALTA MATERIAL';
  requiere_material: boolean;
  accion: string;
  objeto_principal: string;
  sistema: string;
  material_encontrado: boolean;
  descripcion_material: string | null;
  tipo_coincidencia: string;
  confianza: number;
  justificacion: string;
}

export interface AIMaterialVerdict {
  descripcion: string;
  resultado: 'SIN TAREA' | 'JUSTIFICADO';
  tarea_relacionada: string | null;
  confianza: number;
  justificacion: string;
}

export interface AIOMResponse {
  tareas: AITaskVerdict[];
  materiales_huerfanos: AIMaterialVerdict[];
}

export interface PendingAITask {
  orderStr: string;
  tarea: string;
  tareaUp: string;
  equipo: string;
  nombreEquipo: string;
  estadoTarea: string;
  ordData?: {
    tipoOrden: string;
    centrosCostos: string;
    estadoOrden: string;
    contabilizada: string;
    fechaOrden: string;
    statusDoc: string;
  };
}

export interface PendingAIMaterial {
  orderStr: string;
  descripcion: string;
  salidas: number;
  equipo: string;
  nombreEquipo: string;
  ordData?: PendingAITask['ordData'];
}

export interface AIConfig {
  apiKey: string;
  model: string;
  provider: string;
  baseUrl: string;
}
