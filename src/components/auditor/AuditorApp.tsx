'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Upload, FileSpreadsheet, Download, Wrench, Bot, Brain,
  AlertTriangle, XCircle, CheckCircle2, Warehouse, BarChart3,
  ChevronRight, Loader2, Trash2, BookOpen, Lightbulb, Search
} from 'lucide-react';
import type { TareaRow, MaterialRow, AuditResult, UnrecognizedTask, AISuggestion, MetricBreakdown } from '@/lib/audit-types';
import { runAudit, up } from '@/lib/audit-engine';
import { PARTS_TO_CHECK } from '@/lib/parts-dictionary';

const CUSTOM_DICT_KEY = 'ommatcher_custom_dict_v1';

function loadCustomDict(): Record<string, string[]> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(CUSTOM_DICT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveCustomDict(dict: Record<string, string[]>) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(CUSTOM_DICT_KEY, JSON.stringify(dict)); } catch { /* noop */ }
}

async function parseTabularFile(file: File): Promise<Record<string, unknown>[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) {
    const text = await file.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: true });
    return parsed.data as Record<string, unknown>[];
  } else {
    const buf = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    const rows: Record<string, unknown>[] = [];
    let headers: string[] = [];
    ws.eachRow((row, rowNumber) => {
      const values = row.values.slice(1);
      if (rowNumber === 1) {
        headers = values.map(v => (v === undefined || v === null) ? '' : String(v).trim());
      } else {
        const obj: Record<string, unknown> = {};
        headers.forEach((h, i) => {
          let v = values[i];
          if (v && typeof v === 'object' && 'text' in (v as object)) v = (v as { text: unknown }).text;
          if (v && typeof v === 'object' && 'result' in (v as object)) v = (v as { result: unknown }).result;
          obj[h] = v === undefined ? null : v;
        });
        rows.push(obj);
      }
    });
    return rows;
  }
}

function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function thinBorder() {
  const side = { style: 'thin' as const, color: { argb: 'FFD9D9D9' } };
  return { top: side, bottom: side, left: side, right: side };
}

/* =================== SUB-COMPONENTS =================== */

interface FileUploaderProps {
  label: string;
  hint: string;
  accept: string;
  fileName: string | null;
  filled: boolean;
  onFile: (file: File) => void;
  icon: React.ReactNode;
}

function FileUploader({ label, hint, accept, fileName, filled, onFile, icon }: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onFile(f);
  };
  return (
    <Card
      className={`relative cursor-pointer transition-all duration-200 hover:shadow-lg hover:shadow-amber-500/5 border-dashed hover:border-solid group ${
        filled ? 'border-amber-500/50 bg-amber-950/10' : 'border-slate-700/50 bg-slate-900/30'
      }`}
      onClick={() => inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" accept={accept} onChange={handleChange} className="hidden" />
      <CardContent className="p-5 flex items-center gap-4">
        <div className={`p-3 rounded-xl transition-colors ${filled ? 'bg-amber-500/15 text-amber-400' : 'bg-slate-800/80 text-slate-400 group-hover:text-amber-400'}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-slate-200">{label}</p>
          <p className="text-xs text-slate-500 mt-0.5">{hint}</p>
          {fileName && <p className="text-xs text-amber-400 font-mono mt-1 truncate">{fileName}</p>}
        </div>
        {filled && <CheckCircle2 className="w-5 h-5 text-amber-400 shrink-0" />}
        {!filled && <Upload className="w-4 h-4 text-slate-600 shrink-0" />}
      </CardContent>
    </Card>
  );
}

interface WarehouseBarProps {
  name: string;
  count: number;
  max: number;
  color: string;
  barColor: string;
}

function WarehouseBar({ name, count, max, color, barColor }: WarehouseBarProps) {
  const pct = Math.round((count / max) * 100);
  return (
    <div className="flex items-center gap-2.5 py-1">
      <span className="font-mono text-xs text-slate-300 w-10 shrink-0">{name}</span>
      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ease-out ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`font-mono text-xs font-semibold w-8 text-right ${color}`}>{count}</span>
    </div>
  );
}

interface MetricCardProps {
  count: number;
  label: string;
  breakdown: MetricBreakdown;
  hasWarehouse: boolean;
  colorClass: string;
  icon: React.ReactNode;
  bgGlow: string;
  barColor: string;
  valueColor: string;
}

function MetricCard({ count, label, breakdown, hasWarehouse, icon, bgGlow, barColor, valueColor }: MetricCardProps) {
  if (count === 0) return null;
  const maxWh = breakdown.warehouses.length > 0 ? breakdown.warehouses[0].count : 1;
  return (
    <Card className={`relative overflow-hidden border-0 ${bgGlow}`}>
      <div className="absolute top-0 right-0 w-24 h-24 rounded-full blur-3xl opacity-10 bg-current" />
      <CardContent className="p-5 relative">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</p>
            <p className={`text-4xl font-bold font-mono mt-2 ${valueColor}`}>{count}</p>
          </div>
          <div className="p-2.5 rounded-xl bg-white/5">{icon}</div>
        </div>
        <Separator className="my-3 bg-white/10" />
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-400">Tareas afectadas</span>
            <span className={`text-sm font-semibold font-mono ${valueColor}`}>{breakdown.taskCount}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-400">OM únicas</span>
            <span className={`text-sm font-semibold font-mono ${valueColor}`}>{breakdown.uniqueOMs}</span>
          </div>
        </div>
        {hasWarehouse && (
          <>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mt-3 mb-1">Desglose por almacén</p>
            {breakdown.warehouses.length > 0 ? (
              <div>
                {breakdown.warehouses.map(wh => (
                  <WarehouseBar key={wh.name} name={wh.name} count={wh.count} max={maxWh} color={valueColor} barColor={barColor} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic">Sin datos de almacén</p>
            )}
          </>
        )}
        {!hasWarehouse && count > 0 && (
          <>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mt-3 mb-1">Desglose por almacén</p>
            <p className="text-xs text-slate-500 italic">No aplica (0 repuestos)</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function HallazgoBadge({ tipo }: { tipo: string }) {
  let variant: 'amber' | 'orange' | 'green' = 'orange';
  if (tipo.startsWith('1)')) variant = 'amber';
  else if (tipo.startsWith('3)')) variant = 'green';
  const styles = {
    amber: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    orange: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    green: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-md font-mono text-[11px] border ${styles[variant]}`}>
      {tipo}
    </span>
  );
}

/* =================== MAIN COMPONENT =================== */

export default function AuditorApp() {
  const [dfTar, setDfTar] = useState<TareaRow[] | null>(null);
  const [dfMat, setDfMat] = useState<MaterialRow[] | null>(null);
  const [tarFileName, setTarFileName] = useState<string | null>(null);
  const [matFileName, setMatFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customDict, setCustomDict] = useState<Record<string, string[]>>(() => loadCustomDict());
  const [groqKey, setGroqKey] = useState('');
  const [groqModel, setGroqModel] = useState('llama-3.3-70b-versatile');
  const [selectedOrder, setSelectedOrder] = useState('');
  const [aiResult, setAiResult] = useState<{ type: 'loading' | 'result' | 'error' | 'warn'; text: string } | null>(null);
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [aiDictLoading, setAiDictLoading] = useState(false);
  const [aiAnalyzeLoading, setAiAnalyzeLoading] = useState(false);

  const auditOutput = React.useMemo(() => {
    if (!dfTar || !dfMat) return null;
    try {
      return runAudit(dfTar, dfMat, customDict);
    } catch (e) {
      setError(String((e as Error).message));
      return null;
    }
  }, [dfTar, dfMat, customDict]);

  const results = auditOutput?.results || [];
  const unrecognizedTasks = auditOutput?.unrecognizedTasks || [];
  const metrics = auditOutput?.metrics || { c1: 0, c2: 0, c3: 0, b1: { taskCount: 0, uniqueOMs: 0, warehouses: [] }, b2: { taskCount: 0, uniqueOMs: 0, warehouses: [] }, b3: { taskCount: 0, uniqueOMs: 0, warehouses: [] } };
  const uniqueOrders = [...new Set(results.map(r => String(r['Nro. Orden'])))];

  const handleFile = useCallback((
    file: File,
    setDf: (rows: Record<string, unknown>[]) => void,
    setFileName: (n: string) => void
  ) => {
    setFileName(file.name);
    setError(null);
    parseTabularFile(file)
      .then(rows => setDf(rows))
      .catch(e => setError(`Error al leer "${file.name}": ${(e as Error).message}`));
  }, []);

  const handleTarFile = useCallback((f: File) => handleFile(f, (rows) => setDfTar(rows as TareaRow[]), setTarFileName), [handleFile]);
  const handleMatFile = useCallback((f: File) => handleFile(f, (rows) => setDfMat(rows as MaterialRow[]), setMatFileName), [handleFile]);

  const handleExportExcel = useCallback(async () => {
    if (results.length === 0) return;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Auditoría');
    const cols = ['Nro. Orden', 'Equipo', 'Nombre Equipo', 'Tarea', 'Estado Tarea', 'Tipo de Hallazgo', 'Detalle'];
    ws.addRow(cols);
    results.forEach(r => ws.addRow(cols.map(c => r[c as keyof AuditResult])));

    const headerRow = ws.getRow(1);
    headerRow.eachCell(cell => {
      cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F497D' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = thinBorder();
    });

    for (let i = 0; i < results.length; i++) {
      const rowIdx = i + 2;
      const row = ws.getRow(rowIdx);
      const hallazgo = String(results[i]['Tipo de Hallazgo']);
      let fillColor = 'FFFCE4D6';
      if (hallazgo.startsWith('1)')) fillColor = 'FFFFF2CC';
      else if (hallazgo.startsWith('3)')) fillColor = 'FFE2EFDA';
      const altFill = rowIdx % 2 === 0 ? 'FFF9FAFB' : null;
      row.eachCell((cell, colNumber) => {
        cell.border = thinBorder();
        if (colNumber === 6) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
        } else if (altFill) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: altFill } };
        }
        if ([1, 2, 5].includes(colNumber)) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: false };
        }
      });
    }

    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: results.length + 1, column: cols.length } };
    ws.columns.forEach(col => {
      let maxLen = 10;
      col.eachCell({ includeEmpty: true }, cell => {
        const len = cell.value ? String(cell.value).length : 0;
        if (len > maxLen) maxLen = len;
      });
      col.width = Math.min(maxLen + 3, 80);
    });

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Auditoria_Mantenimiento_Generado.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [results]);

  const handleAnalyzeIA = useCallback(async () => {
    if (!groqKey) { setAiResult({ type: 'warn', text: 'Introducí tu Groq API Key para habilitar el diagnóstico por IA.' }); return; }
    const fila = results.find(r => String(r['Nro. Orden']) === selectedOrder);
    if (!fila) { setAiResult({ type: 'error', text: 'No se encontró la orden seleccionada.' }); return; }

    setAiResult({ type: 'loading', text: 'Analizando desvío de taller...' });
    setAiAnalyzeLoading(true);

    const prompt = `Actúa como un Auditor Senior de Flotas de Transporte y Logística. Analizá la siguiente inconsistencia en una Orden de Trabajo:
- Nro Orden: ${fila['Nro. Orden']}
- Vehículo: ${fila['Nombre Equipo']} (${fila['Equipo']})
- Tarea del Mecánico: ${fila['Tarea']}
- Estado de la Tarea: ${fila['Estado Tarea']}
- Diagnóstico del Sistema: ${fila['Tipo de Hallazgo']}
- Datos del Pañol/Stock: ${fila['Detalle']}

Escribí un análisis breve, directo al grano y profesional (en español de Argentina) explicando:
1. Qué error administrativo o humano ocurrió en el taller (Causa Raíz).
2. Qué riesgo representa para el stock general de pañol o para la seguridad física de la unidad.
3. Qué acción correctiva inmediata se le debe exigir al supervisor de taller.`;

    try {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqKey },
        body: JSON.stringify({ model: groqModel, messages: [{ role: 'user', content: prompt }], temperature: 0.3 }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        const msg = data?.error?.message || JSON.stringify(data);
        setAiResult({ type: 'error', text: `Error al conectar con Groq: ${msg}` });
      } else {
        setAiResult({ type: 'result', text: data.choices[0].message.content });
      }
    } catch (e) {
      setAiResult({ type: 'error', text: `Error: ${(e as Error).message}` });
    } finally {
      setAiAnalyzeLoading(false);
    }
  }, [groqKey, groqModel, selectedOrder, results]);

  const handleAnalyzeDict = useCallback(async () => {
    if (!groqKey) { return; }
    if (unrecognizedTasks.length === 0) { return; }

    setAiDictLoading(true);
    const batch = unrecognizedTasks.slice(0, 10);
    const listado = batch.map((u, i) => `${i + 1}. ${u.tarea}`).join('\n');
    const prompt = `Sos un experto en repuestos de mantenimiento de flotas de transporte pesado (camiones, acoplados).
Te paso una lista de tareas de taller que indican un cambio de repuesto, pero cuyo repuesto todavía no está
identificado en un diccionario de categorías.

Para CADA tarea de la lista, identificá:
- "categoria": el nombre genérico del repuesto que se está cambiando, en UNA sola palabra o frase corta,
  en MAYÚSCULAS, sin tildes (ej: NEUMATICO, RODAMIENTO, BOMBA DE AGUA).
- "sinonimos": una lista de 2 a 5 palabras o frases en MAYÚSCULAS sin tildes que podrían aparecer en la
  descripción de ese mismo repuesto en un sistema de stock de pañol (sinónimos, variantes, nombres comerciales).

Si dos tareas de la lista se refieren al mismo repuesto, usá la MISMA categoría para ambas.
Si una tarea no menciona ningún repuesto físico reconocible (por ejemplo, es una tarea administrativa o
ambigua), devolvé "categoria": null para esa tarea.

Respondé ÚNICAMENTE con un array JSON válido, sin texto adicional, sin explicaciones, sin bloques de
markdown, con esta forma exacta:
[{"tarea": "...", "categoria": "...", "sinonimos": ["...", "..."]}, ...]

Lista de tareas:
${listado}`;

    try {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqKey },
        body: JSON.stringify({ model: groqModel, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 4096 }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setSuggestions([]);
        setAiDictLoading(false);
        return;
      }

      let text = data.choices[0].message.content.trim();
      text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      text = text.replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '').trim();
      const firstBracket = text.indexOf('[');
      const lastBracket = text.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket > firstBracket) {
        text = text.substring(firstBracket, lastBracket + 1);
      }
      text = text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
      text = text.replace(/,\s*([}\]])/g, '$1');
      const openBraces = (text.match(/\{/g) || []).length;
      const closeBraces = (text.match(/\}/g) || []).length;
      const openBrackets = (text.match(/\[/g) || []).length;
      const closeBrackets = (text.match(/\]/g) || []).length;
      if (closeBraces < openBraces || closeBrackets < openBrackets) {
        text = text.replace(/,\s*$/, '');
        text += '}'.repeat(openBraces - closeBraces) + ']'.repeat(openBrackets - closeBrackets);
      }

      let parsed: AISuggestion[];
      try { parsed = JSON.parse(text); } catch { parsed = []; }
      if (Array.isArray(parsed)) {
        setSuggestions(parsed.filter(s => s && s.categoria));
      } else {
        setSuggestions([]);
      }
    } catch {
      setSuggestions([]);
    } finally {
      setAiDictLoading(false);
    }
  }, [groqKey, groqModel, unrecognizedTasks]);

  const [editedSuggestions, setEditedSuggestions] = useState<AISuggestion[]>([]);

  const handleSaveSuggestions = useCallback(() => {
    const newDict = { ...customDict };
    const toSave = editedSuggestions.length > 0 ? editedSuggestions : suggestions;
    toSave.forEach(s => {
      const cat = up(s.categoria);
      const syns = (s.sinonimos || []).map(x => up(x)).filter(Boolean);
      if (!cat) return;
      const existing = newDict[cat] || PARTS_TO_CHECK[cat] || [];
      newDict[cat] = [...new Set([...existing, ...syns, cat])];
    });
    setCustomDict(newDict);
    saveCustomDict(newDict);
    setSuggestions([]);
    setEditedSuggestions([]);
  }, [editedSuggestions, suggestions, customDict]);

  const handleDeleteDictEntry = useCallback((cat: string) => {
    const newDict = { ...customDict };
    delete newDict[cat];
    setCustomDict(newDict);
    saveCustomDict(newDict);
  }, [customDict]);

  const handleExportDict = useCallback(() => {
    const blob = new Blob([JSON.stringify(customDict, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'diccionario_repuestos_aprendido.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [customDict]);

  const handleImportDict = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(text => {
      try {
        const imported = JSON.parse(text);
        const newDict = { ...customDict };
        Object.keys(imported).forEach(cat => {
          const catUp = up(cat);
          const existing = newDict[catUp] || [];
          newDict[catUp] = [...new Set([...existing, ...(imported[cat] || []).map((x: string) => up(x))])];
        });
        setCustomDict(newDict);
        saveCustomDict(newDict);
      } catch { /* ignore */ }
    });
    e.target.value = '';
  }, [customDict]);

  const handleClearDict = useCallback(() => {
    if (!confirm('¿Vaciar todo el diccionario aprendido? Podés exportarlo antes si querés conservarlo.')) return;
    setCustomDict({});
    saveCustomDict({});
  }, []);

  const hasResults = results.length > 0;
  const activeTab = hasResults ? 'resultados' : 'carga';

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-slate-950 via-[#0b1520] to-[#081019] text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800/50 bg-slate-950/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-4">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 border border-amber-500/20">
            <Wrench className="w-5 h-5 text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-slate-100 tracking-tight">
              Auditoría de Mantenimiento & Stock
            </h1>
            <p className="text-xs text-slate-500 hidden sm:block">
              Panel de control · Taller & Pañol · Corre 100% local en tu navegador
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <img
              src="/logo-auditor.png"
              alt="Logo"
              className="h-9 w-auto object-contain opacity-90"
            />
          </div>
          <div className="flex items-center gap-2">
            {tarFileName && <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-[10px] font-mono">Tareas ✓</Badge>}
            {matFileName && <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-[10px] font-mono">Materiales ✓</Badge>}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Section 1: File Upload */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-500/15 text-amber-400 text-sm font-bold font-mono">1</div>
            <h2 className="text-base font-semibold text-slate-200">Cargar planillas de datos</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <FileUploader
              label="Tareas (Excel o CSV)"
              hint="Debe tener columna DocNum o Nro. Orden"
              accept=".xlsx,.csv"
              fileName={tarFileName}
              filled={!!tarFileName}
              onFile={handleTarFile}
              icon={<FileSpreadsheet className="w-6 h-6" />}
            />
            <FileUploader
              label="Materiales (Excel o CSV)"
              hint="Debe tener columna Nro. OM o Nro. Orden"
              accept=".xlsx,.csv"
              fileName={matFileName}
              filled={!!matFileName}
              onFile={handleMatFile}
              icon={<Warehouse className="w-6 h-6" />}
            />
          </div>
          {error && (
            <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm flex items-center gap-2">
              <XCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
        </section>

        {/* Section 2: Results */}
        {hasResults && (
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-500/15 text-amber-400 text-sm font-bold font-mono">2</div>
              <h2 className="text-base font-semibold text-slate-200">Resumen de incoherencias encontradas</h2>
            </div>

            {/* Metric Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <MetricCard
                count={metrics.c1}
                label="Sin repuestos asignados"
                breakdown={metrics.b1}
                hasWarehouse={false}
                icon={<AlertTriangle className="w-5 h-5 text-amber-400" />}
                bgGlow="bg-gradient-to-br from-amber-950/40 via-amber-900/10 to-slate-900/40"
                barColor="bg-amber-400"
                valueColor="text-amber-400"
                colorClass="amber"
              />
              <MetricCard
                count={metrics.c2}
                label="Desconexión / cruce erróneo"
                breakdown={metrics.b2}
                hasWarehouse={true}
                icon={<XCircle className="w-5 h-5 text-orange-400" />}
                bgGlow="bg-gradient-to-br from-orange-950/40 via-orange-900/10 to-slate-900/40"
                barColor="bg-orange-400"
                valueColor="text-orange-400"
                colorClass="orange"
              />
              <MetricCard
                count={metrics.c3}
                label="Planificados con Salida = 0"
                breakdown={metrics.b3}
                hasWarehouse={true}
                icon={<BarChart3 className="w-5 h-5 text-emerald-400" />}
                bgGlow="bg-gradient-to-br from-emerald-950/40 via-emerald-900/10 to-slate-900/40"
                barColor="bg-emerald-400"
                valueColor="text-emerald-400"
                colorClass="green"
              />
            </div>

            {/* Results Table */}
            <Card className="border-slate-800/50 bg-slate-900/30">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <Search className="w-4 h-4 text-slate-400" />
                    <CardTitle className="text-sm font-semibold text-slate-300">Detalle de hallazgos</CardTitle>
                    <Badge variant="secondary" className="text-[10px] font-mono">{results.length} registros</Badge>
                  </div>
                  <Button size="sm" onClick={handleExportExcel} className="bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs gap-1.5">
                    <Download className="w-3.5 h-3.5" /> Descargar reporte .xlsx
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[420px]">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-800/50 hover:bg-transparent">
                        <TableHead className="bg-slate-800/80 text-slate-300 text-[11px] uppercase tracking-wider">Nro. Orden</TableHead>
                        <TableHead className="bg-slate-800/80 text-slate-300 text-[11px] uppercase tracking-wider">Equipo</TableHead>
                        <TableHead className="bg-slate-800/80 text-slate-300 text-[11px] uppercase tracking-wider hidden lg:table-cell">Nombre Equipo</TableHead>
                        <TableHead className="bg-slate-800/80 text-slate-300 text-[11px] uppercase tracking-wider">Tarea</TableHead>
                        <TableHead className="bg-slate-800/80 text-slate-300 text-[11px] uppercase tracking-wider hidden md:table-cell">Estado</TableHead>
                        <TableHead className="bg-slate-800/80 text-slate-300 text-[11px] uppercase tracking-wider">Tipo</TableHead>
                        <TableHead className="bg-slate-800/80 text-slate-300 text-[11px] uppercase tracking-wider hidden xl:table-cell">Detalle</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results.map((r, i) => (
                        <TableRow key={i} className="border-slate-800/30 hover:bg-slate-800/20">
                          <TableCell className="font-mono text-xs text-amber-300/80">{esc(r['Nro. Orden'])}</TableCell>
                          <TableCell className="font-mono text-xs">{esc(r['Equipo'])}</TableCell>
                          <TableCell className="text-xs text-slate-400 hidden lg:table-cell">{esc(r['Nombre Equipo'])}</TableCell>
                          <TableCell className="text-xs max-w-[200px] truncate" title={r['Tarea']}>{esc(r['Tarea'])}</TableCell>
                          <TableCell className="text-xs text-slate-400 hidden md:table-cell">{esc(r['Estado Tarea'])}</TableCell>
                          <TableCell><HallazgoBadge tipo={r['Tipo de Hallazgo']} /></TableCell>
                          <TableCell className="text-xs text-slate-500 max-w-[250px] truncate hidden xl:table-cell" title={r['Detalle']}>{esc(r['Detalle'])}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          </section>
        )}

        {/* Section 3: AI Analysis */}
        {hasResults && (
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-500/15 text-amber-400 text-sm font-bold font-mono">3</div>
              <h2 className="text-base font-semibold text-slate-200">Análisis avanzado de causa raíz con IA (Groq)</h2>
            </div>
            <Card className="border-slate-800/50 bg-slate-900/30">
              <CardContent className="p-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-400">Groq API Key</Label>
                    <Input
                      type="password"
                      placeholder="gsk_..."
                      value={groqKey}
                      onChange={e => setGroqKey(e.target.value)}
                      className="bg-slate-800/50 border-slate-700/50 font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-400">Modelo de IA</Label>
                    <Select value={groqModel} onValueChange={setGroqModel}>
                      <SelectTrigger className="bg-slate-800/50 border-slate-700/50 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-700">
                        <SelectItem value="llama-3.3-70b-versatile">llama-3.3-70b-versatile</SelectItem>
                        <SelectItem value="llama-3.1-8b-instant">llama-3.1-8b-instant</SelectItem>
                        <SelectItem value="qwen/qwen3.6-27b">qwen/qwen3.6-27b</SelectItem>
                        <SelectItem value="openai/gpt-oss-120b">openai/gpt-oss-120b</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-400">Orden crítica a auditar</Label>
                    <Select value={selectedOrder} onValueChange={setSelectedOrder}>
                      <SelectTrigger className="bg-slate-800/50 border-slate-700/50 font-mono text-sm">
                        <SelectValue placeholder="Seleccioná una orden..." />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-700 max-h-60">
                        {uniqueOrders.map(o => (
                          <SelectItem key={o} value={o} className="font-mono text-xs">OM {o}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={handleAnalyzeIA}
                    disabled={!groqKey || !selectedOrder || aiAnalyzeLoading}
                    className="bg-amber-500 hover:bg-amber-400 text-black font-semibold gap-2 h-10"
                  >
                    {aiAnalyzeLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                    Analizar con IA
                  </Button>
                </div>
                {aiResult && (
                  <div className={`rounded-lg p-4 text-sm leading-relaxed ${
                    aiResult.type === 'loading' ? 'bg-slate-800/50 text-slate-400' :
                    aiResult.type === 'error' ? 'bg-red-500/10 border border-red-500/30 text-red-300' :
                    aiResult.type === 'warn' ? 'bg-orange-500/10 border border-orange-500/30 text-orange-300' :
                    'bg-slate-800/30 border border-slate-700/50 text-slate-200 whitespace-pre-wrap'
                  }`}>
                    {aiResult.type === 'loading' && <Loader2 className="w-4 h-4 animate-spin inline mr-2" />}
                    {aiResult.type === 'result' && <><Bot className="w-4 h-4 inline mr-2 text-amber-400" /><strong className="text-amber-400">Diagnóstico de la IA:</strong>{'\n\n'}{aiResult.text}</>}
                    {aiResult.type !== 'result' && aiResult.text}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        )}

        {/* Section 4: Learning */}
        {hasResults && (
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-500/15 text-amber-400 text-sm font-bold font-mono">4</div>
              <h2 className="text-base font-semibold text-slate-200">Aprendizaje asistido por IA</h2>
            </div>
            <Card className="border-slate-800/50 bg-slate-900/30">
              <CardHeader className="pb-3">
                <CardDescription className="text-xs text-slate-400 leading-relaxed">
                  Tareas que piden un cambio de repuesto cuyo nombre todavía no está en el diccionario.
                  La IA sugiere a qué categoría pertenecen — revisá y elegí cuáles sumar.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-5 pt-0 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <Badge variant="outline" className="text-xs font-mono border-slate-700 text-slate-400">
                    {unrecognizedTasks.length} tarea(s) sin categoría reconocida
                  </Badge>
                  <div className="flex gap-2 flex-wrap">
                    <Button variant="outline" size="sm" onClick={handleExportDict} className="text-xs gap-1.5 border-slate-700 hover:border-slate-500">
                      <Download className="w-3.5 h-3.5" /> Exportar diccionario
                    </Button>
                    <label className="inline-flex items-center cursor-pointer">
                      <Button variant="outline" size="sm" className="text-xs gap-1.5 border-slate-700 hover:border-slate-500 pointer-events-none" asChild>
                        <span><Download className="w-3.5 h-3.5 rotate-180" /> Importar diccionario</span>
                      </Button>
                      <input type="file" accept=".json" onChange={handleImportDict} className="hidden" />
                    </label>
                    <Button
                      size="sm"
                      onClick={handleAnalyzeDict}
                      disabled={!groqKey || unrecognizedTasks.length === 0 || aiDictLoading}
                      className="bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs gap-1.5"
                    >
                      {aiDictLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
                      Analizar con IA
                    </Button>
                  </div>
                </div>

                {/* Unrecognized tasks table */}
                <ScrollArea className="h-[160px]">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-800/50 hover:bg-transparent">
                        <TableHead className="bg-slate-800/80 text-slate-300 text-[11px] uppercase tracking-wider">Tarea (sin categoría)</TableHead>
                        <TableHead className="bg-slate-800/80 text-slate-300 text-[11px] uppercase tracking-wider w-20">Apariciones</TableHead>
                        <TableHead className="bg-slate-800/80 text-slate-300 text-[11px] uppercase tracking-wider w-24">Ej. Orden</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unrecognizedTasks.length === 0 ? (
                        <TableRow><TableCell colSpan={3} className="text-center text-slate-500 text-xs py-8">Todas las tareas coinciden con alguna categoría del diccionario.</TableCell></TableRow>
                      ) : (
                        unrecognizedTasks.map((u, i) => (
                          <TableRow key={i} className="border-slate-800/30 hover:bg-slate-800/20">
                            <TableCell className="font-mono text-xs">{esc(u.tarea)}</TableCell>
                            <TableCell className="font-mono text-xs text-amber-400">{u.count}</TableCell>
                            <TableCell className="font-mono text-xs text-slate-400">{esc(u.order)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </ScrollArea>

                {/* AI Suggestions */}
                {suggestions.length > 0 && (
                  <div className="space-y-3 mt-2">
                    <p className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                      <Lightbulb className="w-3.5 h-3.5 text-amber-400" /> Sugerencias de la IA — revisá y ajustá antes de guardar
                    </p>
                    {suggestions.map((s, i) => (
                      <SuggestionCard key={i} suggestion={s} index={i} onUpdate={(updated) => {
                        setEditedSuggestions(prev => {
 const next = [...prev];
                          next[i] = updated;
                          return next;
                        });
                      }} />
                    ))}
                    <Button onClick={handleSaveSuggestions} className="bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs gap-1.5">
                      Guardar seleccionadas en el diccionario
                    </Button>
                  </div>
                )}

                {/* Custom dictionary */}
                <Separator className="bg-slate-800/50" />
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5" /> Diccionario aprendido en este navegador
                    </p>
                    <Button variant="ghost" size="sm" onClick={handleClearDict} className="text-xs text-slate-500 hover:text-red-400 gap-1">
                      <Trash2 className="w-3 h-3" /> Vaciar
                    </Button>
                  </div>
                  {Object.keys(customDict).length === 0 ? (
                    <p className="text-xs text-slate-600 italic">Todavía no se aprendió ninguna categoría nueva.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(customDict).map(([cat, syns]) => (
                        <Badge key={cat} variant="outline" className="border-slate-700/50 bg-slate-800/30 px-3 py-1.5 gap-2 text-xs">
                          <span className="font-semibold text-amber-400 font-mono">{cat}</span>
                          <span className="text-slate-500 font-mono">{syns.join(', ')}</span>
                          <button onClick={() => handleDeleteDictEntry(cat)} className="text-red-400/60 hover:text-red-400 font-bold ml-1">✕</button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-800/50 py-4">
        <p className="text-center text-[10px] text-slate-600 font-mono tracking-wider uppercase">
          Desarrollado para optimización y control logístico de flotas · Corre 100% local en el navegador
        </p>
      </footer>
    </div>
  );
}

/* =================== SUGGESTION CARD (with local state) =================== */

function SuggestionCard({ suggestion, index, onUpdate }: { suggestion: AISuggestion; index: number; onUpdate: (updated: AISuggestion) => void }) {
  const [cat, setCat] = useState(up(suggestion.categoria || ''));
  const [syns, setSyns] = useState((suggestion.sinonimos || []).map(x => up(x)).join(', '));
  const [checked, setChecked] = useState(true);

  useEffect(() => {
    onUpdate({ ...suggestion, categoria: cat, sinonimos: syns.split(',').map(x => x.trim()).filter(Boolean) });
  }, [cat, syns]);

  return (
    <Card className="border-slate-700/50 bg-slate-800/30">
      <CardContent className="p-4">
        <p className="font-mono text-xs text-slate-400 mb-3 break-words">&quot;{esc(suggestion.tarea)}&quot;</p>
        <div className="grid grid-cols-[auto_1fr] gap-3 items-center">
          <Checkbox checked={checked} onCheckedChange={(v) => setChecked(!!v)} className="data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              value={cat}
              onChange={e => setCat(up(e.target.value))}
              placeholder="CATEGORÍA"
              className="font-mono text-xs bg-slate-900/50 border-slate-700/50 h-8"
            />
            <Input
              value={syns}
              onChange={e => setSyns(e.target.value)}
              placeholder="Sinónimos separados por coma"
              className="font-mono text-xs bg-slate-900/50 border-slate-700/50 h-8"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}