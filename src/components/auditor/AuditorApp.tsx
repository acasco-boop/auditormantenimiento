'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import ExcelJS from 'exceljs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Upload, FileSpreadsheet, Download, Wrench, Bot, Brain,
  AlertTriangle, XCircle, CheckCircle2, Warehouse, BarChart3,
  ChevronRight, Loader2, Trash2, BookOpen, Lightbulb, Search,
  Sparkles, Shield, Zap, ClipboardList, ShoppingCart
} from 'lucide-react';
import type { TareaRow, MaterialRow, OrdenRow, AuditResult, UnrecognizedTask, AISuggestion, MetricBreakdown } from '@/lib/audit-types';
import { runAudit, up } from '@/lib/audit-engine';
import { PARTS_TO_CHECK } from '@/lib/parts-dictionary';
import { parseTabularFile, esc, thinBorder } from './shared-utils';
import OVTab from './OVTab';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const CUSTOM_DICT_KEY = 'ommatcher_custom_dict_v1';

function loadCustomDict(): Record<string, string[]> {
  if (typeof window === 'undefined') return {};
  try { const r = localStorage.getItem(CUSTOM_DICT_KEY); return r ? JSON.parse(r) : {}; } catch { return {}; }
}
function saveCustomDict(dict: Record<string, string[]>) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(CUSTOM_DICT_KEY, JSON.stringify(dict)); } catch { /* noop */ }
}



/* =================== ANIMATED BACKGROUND =================== */

function AnimatedBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
      {/* Deep navy base gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#060d18] via-[#0a1628] to-[#050c16]" />

      {/* Orb 1: Amber top-left */}
      <div className="orb-1 absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full bg-amber-500/[0.07] blur-[100px]" />
      {/* Orb 2: Teal bottom-right */}
      <div className="orb-2 absolute -bottom-48 -right-48 w-[600px] h-[600px] rounded-full bg-teal-500/[0.05] blur-[120px]" />
      {/* Orb 3: Orange center */}
      <div className="orb-3 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full bg-orange-500/[0.03] blur-[80px]" />

      {/* Subtle grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }}
      />
    </div>
  );
}

/* =================== SUB-COMPONENTS =================== */

interface FileUploaderProps {
  label: string; hint: string; accept: string; fileName: string | null;
  filled: boolean; onFile: (file: File) => void; icon: React.ReactNode;
}

function FileUploader({ label, hint, accept, fileName, filled, onFile, icon }: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) onFile(f);
  };
  return (
    <div
      className={`upload-zone glass-card rounded-2xl cursor-pointer group animate-fade-in-up ${
        filled
          ? 'gradient-border-amber'
          : ''
      }`}
      onClick={() => inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" accept={accept} onChange={handleChange} className="hidden" />
      <div className="p-6 flex items-center gap-4">
        <div className={`upload-icon p-3.5 rounded-2xl transition-all duration-300 ${
          filled
            ? 'bg-gradient-to-br from-amber-500/20 to-orange-500/10 text-amber-400 shadow-lg shadow-amber-500/10'
            : 'bg-slate-800/60 text-slate-500 group-hover:text-amber-400 group-hover:bg-slate-800/80'
        }`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`font-semibold text-sm transition-colors ${filled ? 'text-amber-100' : 'text-slate-200 group-hover:text-white'}`}>{label}</p>
          <p className="text-xs text-slate-500 mt-1">{hint}</p>
          {fileName && (
            <div className="flex items-center gap-2 mt-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <p className="text-xs text-emerald-400/80 font-mono truncate">{fileName}</p>
            </div>
          )}
        </div>
        {!filled && (
          <div className="p-2 rounded-xl bg-slate-800/40 text-slate-600 group-hover:text-amber-400/50 group-hover:bg-amber-500/5 transition-all">
            <Upload className="w-4 h-4" />
          </div>
        )}
      </div>
    </div>
  );
}

interface WarehouseBarProps { name: string; count: number; max: number; barColor: string; valueColor: string; }

function WarehouseBar({ name, count, max, barColor, valueColor }: WarehouseBarProps) {
  const pct = Math.round((count / max) * 100);
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className="font-mono text-[11px] text-slate-300 w-10 shrink-0">{name}</span>
      <div className="flex-1 h-2 bg-slate-800/80 rounded-full overflow-hidden shadow-inner">
        <div
          className={`h-full rounded-full animate-bar-grow ${barColor} shadow-sm`}
          style={{ width: `${pct}%`, animationDelay: `${Math.random() * 0.3}s` }}
        />
      </div>
      <span className={`font-mono text-xs font-bold w-8 text-right ${valueColor}`}>{count}</span>
    </div>
  );
}

interface MetricCardProps {
  count: number; label: string; breakdown: MetricBreakdown; hasWarehouse: boolean;
  icon: React.ReactNode; bgGlow: string; barColor: string; valueColor: string;
  gradientBorder: string; delay: string;
}

function MetricCard({ count, label, breakdown, hasWarehouse, icon, bgGlow, barColor, valueColor, gradientBorder, delay }: MetricCardProps) {
  if (count === 0) return null;
  const maxWh = breakdown.warehouses.length > 0 ? breakdown.warehouses[0].count : 1;
  return (
    <div className={`glass-card rounded-2xl overflow-hidden ${gradientBorder} animate-fade-in-up ${delay}`}>
      <div className={`relative p-6 ${bgGlow}`}>
        {/* Decorative glow */}
        <div className={`absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-15 bg-current ${valueColor.replace('text-', 'text-')}`} />

        <div className="relative">
          <div className="flex items-start justify-between mb-1">
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">{label}</p>
            </div>
            <div className={`p-2.5 rounded-xl bg-white/[0.04] backdrop-blur-sm border border-white/[0.06]`}>
              {icon}
            </div>
          </div>

          <p className={`text-5xl font-bold font-mono mt-3 mb-4 animate-count-up ${valueColor}`} style={{ animationDelay: `${delay === 'animate-fade-in-up-1' ? '0.2' : delay === 'animate-fade-in-up-2' ? '0.28' : '0.36'}s` }}>
            {count}
          </p>

          <div className="h-px bg-gradient-to-r from-white/[0.06] via-white/[0.1] to-white/[0.06] mb-4" />

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Tareas</p>
              <p className={`text-lg font-bold font-mono ${valueColor}`}>{breakdown.taskCount}</p>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">OM únicas</p>
              <p className={`text-lg font-bold font-mono ${valueColor}`}>{breakdown.uniqueOMs}</p>
            </div>
          </div>

          {hasWarehouse && breakdown.warehouses.length > 0 && (
            <>
              <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500/80 font-bold mb-2">Por almacén</p>
              <div>
                {breakdown.warehouses.map(wh => (
                  <WarehouseBar key={wh.name} name={wh.name} count={wh.count} max={maxWh} color={valueColor} barColor={barColor} valueColor={valueColor} />
                ))}
              </div>
            </>
          )}
          {breakdown.tiposOrden && breakdown.tiposOrden.length > 0 && (
            <>
              <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500/80 font-bold mb-2 mt-3">Por tipo de OM</p>
              <div className="flex flex-wrap gap-1.5">
                {breakdown.tiposOrden.map(t => (
                  <Badge key={t.name} variant="outline" className="text-[10px] font-mono border-violet-500/25 text-violet-300 bg-violet-500/[0.07]">
                    {t.name} <span className="text-violet-400/70 ml-1">{t.count}</span>
                  </Badge>
                ))}
              </div>
            </>
          )}
          {!hasWarehouse && count > 0 && (
            <p className="text-xs text-slate-600 italic mt-2">Sin datos de almacén</p>
          )}
        </div>
      </div>
    </div>
  );
}

function HallazgoBadge({ tipo }: { tipo: string }) {
  let cls = 'bg-orange-500/15 text-orange-400 border-orange-500/30';
  if (tipo.startsWith('1)')) cls = 'bg-amber-500/15 text-amber-400 border-amber-500/25';
  else if (tipo.startsWith('3)')) cls = 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25';
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg font-mono text-[10px] border ${cls}`}>
      {tipo}
    </span>
  );
}

function SectionNumber({ n }: { n: number }) {
  return (
    <div className="section-badge w-8 h-8 rounded-xl flex items-center justify-center text-amber-400 text-sm font-bold font-mono shrink-0">
      {n}
    </div>
  );
}

/* =================== MAIN COMPONENT =================== */

export default function AuditorApp() {
  const [dfTar, setDfTar] = useState<TareaRow[] | null>(null);
  const [dfMat, setDfMat] = useState<MaterialRow[] | null>(null);
  const [dfOrd, setDfOrd] = useState<OrdenRow[] | null>(null);
  const [tarFileName, setTarFileName] = useState<string | null>(null);
  const [matFileName, setMatFileName] = useState<string | null>(null);
  const [ordFileName, setOrdFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customDict, setCustomDict] = useState<Record<string, string[]>>(() => loadCustomDict());
  const [groqKey, setGroqKey] = useState('');
  const [groqModel, setGroqModel] = useState('llama-3.3-70b-versatile');
  const [selectedOrder, setSelectedOrder] = useState('');
  const [aiResult, setAiResult] = useState<{ type: 'loading' | 'result' | 'error' | 'warn'; text: string } | null>(null);
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [editedSuggestions, setEditedSuggestions] = useState<AISuggestion[]>([]);
  const [aiDictLoading, setAiDictLoading] = useState(false);
  const [aiAnalyzeLoading, setAiAnalyzeLoading] = useState(false);

  const auditOutput = React.useMemo(() => {
    if (!dfTar || !dfMat) return null;
    try { return runAudit(dfTar, dfMat, customDict, dfOrd); }
    catch (e) { setError(String((e as Error).message)); return null; }
  }, [dfTar, dfMat, customDict, dfOrd]);

  const results = auditOutput?.results || [];
  const unrecognizedTasks = auditOutput?.unrecognizedTasks || [];
  const metrics = auditOutput?.metrics || { c1: 0, c2: 0, c3: 0, b1: { taskCount: 0, uniqueOMs: 0, warehouses: [], tiposOrden: [] }, b2: { taskCount: 0, uniqueOMs: 0, warehouses: [], tiposOrden: [] }, b3: { taskCount: 0, uniqueOMs: 0, warehouses: [], tiposOrden: [] } };
  const uniqueOrders = [...new Set(results.map(r => String(r['Nro. Orden'])))];

  const handleFile = useCallback((file: File, setDf: (rows: Record<string, unknown>[]) => void, setFileName: (n: string) => void) => {
    setFileName(file.name); setError(null);
    parseTabularFile(file).then(rows => setDf(rows)).catch(e => setError(`Error al leer "${file.name}": ${(e as Error).message}`));
  }, []);
  const handleTarFile = useCallback((f: File) => handleFile(f, (rows) => setDfTar(rows as TareaRow[]), setTarFileName), [handleFile]);
  const handleMatFile = useCallback((f: File) => handleFile(f, (rows) => setDfMat(rows as MaterialRow[]), setMatFileName), [handleFile]);
  const handleOrdFile = useCallback((f: File) => handleFile(f, (rows) => setDfOrd(rows as OrdenRow[]), setOrdFileName), [handleFile]);

  const handleExportExcel = useCallback(async () => {
    if (results.length === 0) return;
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Auditoría');
    const cols = ['Nro. Orden', 'Tipo de orden', 'Centros de costos', 'Equipo', 'Nombre Equipo', 'Tarea', 'Estado Tarea', 'Tipo de Hallazgo', 'Detalle'];
    ws.addRow(cols); results.forEach(r => ws.addRow(cols.map(c => r[c as keyof AuditResult])));
    const headerRow = ws.getRow(1);
    headerRow.eachCell(cell => { cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F497D' } }; cell.alignment = { horizontal: 'center', vertical: 'middle' }; cell.border = thinBorder(); });
    for (let i = 0; i < results.length; i++) {
      const rowIdx = i + 2; const row = ws.getRow(rowIdx);
      const hallazgo = String(results[i]['Tipo de Hallazgo']);
      let fillColor = 'FFFCE4D6'; if (hallazgo.startsWith('1)')) fillColor = 'FFFFF2CC'; else if (hallazgo.startsWith('3)')) fillColor = 'FFE2EFDA';
      const altFill = rowIdx % 2 === 0 ? 'FFF9FAFB' : null;
      row.eachCell((cell, colNumber) => { cell.border = thinBorder(); if (colNumber === 6) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } }; else if (altFill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: altFill } }; if ([1, 2, 5].includes(colNumber)) cell.alignment = { horizontal: 'center', vertical: 'middle' }; else cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: false }; });
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: results.length + 1, column: cols.length } };
    ws.columns.forEach(col => { let maxLen = 10; col.eachCell({ includeEmpty: true }, cell => { const len = cell.value ? String(cell.value).length : 0; if (len > maxLen) maxLen = len; }); col.width = Math.min(maxLen + 3, 80); });
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = 'Auditoria_Mantenimiento_Generado.xlsx';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }, [results]);

  const handleAnalyzeIA = useCallback(async () => {
    if (!groqKey) { setAiResult({ type: 'warn', text: 'Introducí tu Groq API Key para habilitar el diagnóstico por IA.' }); return; }
    const fila = results.find(r => String(r['Nro. Orden']) === selectedOrder);
    if (!fila) { setAiResult({ type: 'error', text: 'No se encontró la orden seleccionada.' }); return; }
    setAiResult({ type: 'loading', text: 'Analizando desvío de taller...' }); setAiAnalyzeLoading(true);
    const prompt = `Actúa como un Auditor Senior de Flotas de Transporte y Logística. Analizá la siguiente inconsistencia en una Orden de Trabajo:
- Nro Orden: ${fila['Nro. Orden']}
- Tipo de Orden: ${fila['Tipo de orden'] || 'No disponible'}
- Centro de Costos: ${fila['Centros de costos'] || 'No disponible'}
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
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqKey }, body: JSON.stringify({ model: groqModel, messages: [{ role: 'user', content: prompt }], temperature: 0.3 }) });
      const data = await resp.json();
      if (!resp.ok) { const msg = data?.error?.message || JSON.stringify(data); setAiResult({ type: 'error', text: `Error: ${msg}` }); }
      else { setAiResult({ type: 'result', text: data.choices[0].message.content }); }
    } catch (e) { setAiResult({ type: 'error', text: `Error: ${(e as Error).message}` }); }
    finally { setAiAnalyzeLoading(false); }
  }, [groqKey, groqModel, selectedOrder, results]);

  const handleAnalyzeDict = useCallback(async () => {
    if (!groqKey || unrecognizedTasks.length === 0) return;
    setAiDictLoading(true);
    const batch = unrecognizedTasks.slice(0, 10);
    const listado = batch.map((u, i) => `${i + 1}. ${u.tarea}`).join('\n');
    const prompt = `Sos un experto en repuestos de mantenimiento de flotas de transporte pesado (camiones, acoplados).
Te paso una lista de tareas de taller que indican un cambio de repuesto, pero cuyo repuesto todavía no está identificado en un diccionario de categorías.
Para CADA tarea de la lista, identificá:
- "categoria": el nombre genérico del repuesto que se está cambiando, en UNA sola palabra o frase corta, en MAYÚSCULAS, sin tildes.
- "sinonimos": una lista de 2 a 5 palabras o frases en MAYÚSCULAS sin tildes.
Si dos tareas se refieren al mismo repuesto, usá la MISMA categoría. Si no menciona repuesto, devolvé "categoria": null.
Respondé ÚNICAMENTE con un array JSON válido, sin texto adicional: [{"tarea":"...","categoria":"...","sinonimos":["...","..."]},...]
Lista de tareas:\n${listado}`;
    try {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqKey }, body: JSON.stringify({ model: groqModel, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 4096 }) });
      const data = await resp.json();
      if (!resp.ok) { setSuggestions([]); setAiDictLoading(false); return; }
      let text = data.choices[0].message.content.trim();
      text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim().replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '').trim();
      const fb = text.indexOf('['), lb = text.lastIndexOf(']');
      if (fb !== -1 && lb > fb) text = text.substring(fb, lb + 1);
      text = text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/,\s*([}\]])/g, '$1');
      const ob = (text.match(/\{/g) || []).length, cb = (text.match(/\}/g) || []).length, bra = (text.match(/\[/g) || []).length, bra2 = (text.match(/\]/g) || []).length;
      if (cb < ob || bra2 < bra) { text = text.replace(/,\s*$/, ''); text += '}'.repeat(ob - cb) + ']'.repeat(bra - bra2); }
      let parsed: AISuggestion[];
      try { parsed = JSON.parse(text); } catch { parsed = []; }
      setSuggestions(Array.isArray(parsed) ? parsed.filter(s => s && s.categoria) : []);
    } catch { setSuggestions([]); }
    finally { setAiDictLoading(false); }
  }, [groqKey, groqModel, unrecognizedTasks]);

  const handleSaveSuggestions = useCallback(() => {
    const newDict = { ...customDict };
    const toSave = editedSuggestions.length > 0 ? editedSuggestions : suggestions;
    toSave.forEach(s => { const cat = up(s.categoria); const syns = (s.sinonimos || []).map(x => up(x)).filter(Boolean); if (!cat) return; newDict[cat] = [...new Set([...(newDict[cat] || PARTS_TO_CHECK[cat] || []), ...syns, cat])]; });
    setCustomDict(newDict); saveCustomDict(newDict); setSuggestions([]); setEditedSuggestions([]);
  }, [editedSuggestions, suggestions, customDict]);

  const handleDeleteDictEntry = useCallback((cat: string) => { const d = { ...customDict }; delete d[cat]; setCustomDict(d); saveCustomDict(d); }, [customDict]);
  const handleExportDict = useCallback(() => { const b = new Blob([JSON.stringify(customDict, null, 2)], { type: 'application/json' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'diccionario_repuestos_aprendido.json'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u); }, [customDict]);
  const handleImportDict = useCallback((e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (!f) return; f.text().then(t => { try { const imp = JSON.parse(t); const nd = { ...customDict }; Object.keys(imp).forEach(c => { const cu = up(c); nd[cu] = [...new Set([...(nd[cu] || []), ...(imp[c] || []).map((x: string) => up(x))])]; }); setCustomDict(nd); saveCustomDict(nd); } catch { /* */ } }); e.target.value = ''; }, [customDict]);
  const handleClearDict = useCallback(() => { if (!confirm('¿Vaciar todo el diccionario aprendido?')) return; setCustomDict({}); saveCustomDict({}); }, []);

  const hasResults = results.length > 0;

  return (
    <div className="min-h-screen flex flex-col text-slate-100 relative">
      <AnimatedBackground />

      {/* Header */}
      <header className="relative z-10 bg-slate-950/60 backdrop-blur-2xl border-b border-white/[0.04]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-amber-500/25 to-orange-600/10 border border-amber-500/20 shadow-lg shadow-amber-500/10">
            <Wrench className="w-5 h-5 text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-xl font-bold bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent tracking-tight">
              Auditoría de Mantenimiento & Stock
            </h1>
            <p className="text-[11px] text-slate-500 hidden sm:flex items-center gap-2 mt-0.5">
              <Zap className="w-3 h-3 text-amber-500/50" />
              Panel de control · Taller & Pañol · Procesamiento 100% local
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <img src="/logo-auditor.png" alt="Logo" className="h-14 w-auto object-contain opacity-90" />
          </div>
          <div className="flex items-center gap-2">
            {tarFileName && <Badge className="bg-emerald-500/10 border-emerald-500/25 text-emerald-400 text-[10px] font-mono hover:bg-emerald-500/15">Tareas ✓</Badge>}
            {matFileName && <Badge className="bg-emerald-500/10 border-emerald-500/25 text-emerald-400 text-[10px] font-mono hover:bg-emerald-500/15">Materiales ✓</Badge>}
            {ordFileName && <Badge className="bg-emerald-500/10 border-emerald-500/25 text-emerald-400 text-[10px] font-mono hover:bg-emerald-500/15">Órdenes ✓</Badge>}
          </div>
        </div>
        <div className="header-glow" />
      </header>

      <main className="relative z-10 flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <Tabs defaultValue="mantenimiento" className="space-y-6">
          <TabsList className="glass-card rounded-2xl p-1.5 h-auto bg-slate-900/50 border border-white/[0.06]">
            <TabsTrigger value="mantenimiento" className="rounded-xl px-5 py-2.5 text-xs font-semibold data-[state=active]:bg-gradient-to-r data-[state=active]:from-amber-500/20 data-[state=active]:to-orange-500/10 data-[state=active]:text-amber-100 data-[state=active]:shadow-lg data-[state=active]:shadow-amber-500/5 text-slate-400 gap-2 transition-all">
              <Wrench className="w-3.5 h-3.5" />
              Mantenimiento & Stock
            </TabsTrigger>
            <TabsTrigger value="ov" className="rounded-xl px-5 py-2.5 text-xs font-semibold data-[state=active]:bg-gradient-to-r data-[state=active]:from-cyan-500/20 data-[state=active]:to-blue-500/10 data-[state=active]:text-cyan-100 data-[state=active]:shadow-lg data-[state=active]:shadow-cyan-500/5 text-slate-400 gap-2 transition-all">
              <ShoppingCart className="w-3.5 h-3.5" />
              OV vs Materiales
            </TabsTrigger>
          </TabsList>

          <TabsContent value="mantenimiento" className="space-y-8 mt-6">

        {/* Section 1: Upload */}
        <section className="animate-fade-in-up animate-fade-in-up-1">
          <div className="flex items-center gap-3 mb-5">
            <SectionNumber n={1} />
            <div>
              <h2 className="text-base font-semibold text-white">Cargar planillas de datos</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">Subí los archivos Excel o CSV del período a auditar</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FileUploader label="Tareas (Excel o CSV)" hint="Columna requerida: DocNum o Nro. Orden" accept=".xlsx,.csv" fileName={tarFileName} filled={!!tarFileName} onFile={handleTarFile} icon={<FileSpreadsheet className="w-6 h-6" />} />
            <FileUploader label="Materiales (Excel o CSV)" hint="Columna requerida: Nro. OM o Nro. Orden" accept=".xlsx,.csv" fileName={matFileName} filled={!!matFileName} onFile={handleMatFile} icon={<Warehouse className="w-6 h-6" />} />
            <FileUploader label="Órdenes (Excel o CSV) — Opcional" hint="Agrega Tipo de orden y Centros de costos por OM" accept=".xlsx,.csv" fileName={ordFileName} filled={!!ordFileName} onFile={handleOrdFile} icon={<ClipboardList className="w-6 h-6" />} />
          </div>
          {error && (
            <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm flex items-center gap-3 backdrop-blur-sm">
              <div className="p-1.5 rounded-lg bg-red-500/20"><XCircle className="w-4 h-4" /></div>
              {error}
            </div>
          )}
        </section>

        {/* Section 2: Results */}
        {hasResults && (
          <section className="animate-fade-in-up animate-fade-in-up-2">
            <div className="flex items-center gap-3 mb-5">
              <SectionNumber n={2} />
              <div>
                <h2 className="text-base font-semibold text-white">Resumen de incoherencias</h2>
                <p className="text-[11px] text-slate-500 mt-0.5">{results.length} hallazgos en {uniqueOrders.length} órdenes de trabajo</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
              <MetricCard count={metrics.c1} label="Sin repuestos asignados" breakdown={metrics.b1} hasWarehouse={false}
                icon={<AlertTriangle className="w-5 h-5 text-amber-400" />}
                bgGlow="bg-gradient-to-br from-amber-950/50 via-amber-900/15 to-transparent"
                barColor="bg-gradient-to-r from-amber-500 to-amber-400" valueColor="text-amber-400"
                gradientBorder="gradient-border-amber" delay="animate-fade-in-up-1" />
              <MetricCard count={metrics.c2} label="Desconexión / cruce erróneo" breakdown={metrics.b2} hasWarehouse={true}
                icon={<XCircle className="w-5 h-5 text-orange-400" />}
                bgGlow="bg-gradient-to-br from-orange-950/50 via-orange-900/15 to-transparent"
                barColor="bg-gradient-to-r from-orange-500 to-orange-400" valueColor="text-orange-400"
                gradientBorder="gradient-border-orange" delay="animate-fade-in-up-2" />
              <MetricCard count={metrics.c3} label="Planificados con Salida = 0" breakdown={metrics.b3} hasWarehouse={true}
                icon={<BarChart3 className="w-5 h-5 text-emerald-400" />}
                bgGlow="bg-gradient-to-br from-emerald-950/50 via-emerald-900/15 to-transparent"
                barColor="bg-gradient-to-r from-emerald-500 to-teal-400" valueColor="text-emerald-400"
                gradientBorder="gradient-border-emerald" delay="animate-fade-in-up-3" />
            </div>

            {/* Table */}
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-3 border-b border-white/[0.04]">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-amber-500/10"><Search className="w-3.5 h-3.5 text-amber-400/70" /></div>
                  <span className="text-sm font-semibold text-slate-200">Detalle de hallazgos</span>
                  <Badge variant="secondary" className="text-[10px] font-mono bg-white/[0.05]">{results.length}</Badge>
                </div>
                <Button size="sm" onClick={handleExportExcel} className="btn-shimmer text-black font-semibold text-xs gap-1.5 rounded-xl">
                  <Download className="w-3.5 h-3.5" /> Descargar .xlsx
                </Button>
              </div>
              <ScrollArea className="h-[420px]">
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/[0.04] hover:bg-transparent">
                      {['Nro. Orden', 'Tipo OM', 'C.Costos', 'Equipo', 'Tarea', 'Tipo', 'Detalle'].map((h, i) => (
                        <TableHead key={h} className={`bg-white/[0.02] text-slate-400 text-[10px] uppercase tracking-widest font-semibold ${i === 1 ? 'hidden lg:table-cell' : ''} ${i === 3 ? 'hidden lg:table-cell' : ''} ${i === 6 ? 'hidden xl:table-cell' : ''}`}>{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r, i) => (
                      <TableRow key={i} className="border-white/[0.03] table-row-glow">
                        <TableCell className="font-mono text-xs text-amber-300/70">{esc(r['Nro. Orden'])}</TableCell>
                        <TableCell className="text-xs hidden lg:table-cell">
                          {r['Tipo de orden'] ? (
                            <Badge variant="outline" className="text-[10px] font-mono border-violet-500/25 text-violet-300 bg-violet-500/[0.07]">{esc(r['Tipo de orden'])}</Badge>
                          ) : <span className="text-slate-600 text-xs">—</span>}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-teal-300/80">{esc(r['Centros de costos']) || <span className="text-slate-600">—</span>}</TableCell>
                        <TableCell className="font-mono text-xs text-slate-300 hidden lg:table-cell">{esc(r['Equipo'])}</TableCell>
                        <TableCell className="text-xs text-slate-300 max-w-[200px] truncate" title={r['Tarea']}>{esc(r['Tarea'])}</TableCell>
                        <TableCell><HallazgoBadge tipo={r['Tipo de Hallazgo']} /></TableCell>
                        <TableCell className="text-xs text-slate-500 max-w-[250px] truncate hidden xl:table-cell" title={r['Detalle']}>{esc(r['Detalle'])}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          </section>
        )}

        {/* Section 3: AI Analysis */}
        {hasResults && (
          <section className="animate-fade-in-up animate-fade-in-up-3">
            <div className="flex items-center gap-3 mb-5">
              <SectionNumber n={3} />
              <div>
                <h2 className="text-base font-semibold text-white">Análisis de causa raíz con IA</h2>
                <p className="text-[11px] text-slate-500 mt-0.5">Diagnóstico inteligente de cada orden usando Groq</p>
              </div>
            </div>
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="p-6 space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-400 flex items-center gap-1.5"><Shield className="w-3 h-3" /> API Key</Label>
                    <Input type="password" placeholder="gsk_..." value={groqKey} onChange={e => setGroqKey(e.target.value)} className="bg-white/[0.03] border-white/[0.06] font-mono text-sm h-10 rounded-xl focus:border-amber-500/30" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-400 flex items-center gap-1.5"><Sparkles className="w-3 h-3" /> Modelo</Label>
                    <Select value={groqModel} onValueChange={setGroqModel}>
                      <SelectTrigger className="bg-white/[0.03] border-white/[0.06] text-sm h-10 rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-slate-800/95 backdrop-blur-xl border-white/[0.08]">
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
                    <Label className="text-xs text-slate-400">Orden a auditar</Label>
                    <Select value={selectedOrder} onValueChange={setSelectedOrder}>
                      <SelectTrigger className="bg-white/[0.03] border-white/[0.06] font-mono text-sm h-10 rounded-xl"><SelectValue placeholder="Seleccioná una orden..." /></SelectTrigger>
                      <SelectContent className="bg-slate-800/95 backdrop-blur-xl border-white/[0.08] max-h-60">
                        {uniqueOrders.map(o => (<SelectItem key={o} value={o} className="font-mono text-xs">OM {o}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleAnalyzeIA} disabled={!groqKey || !selectedOrder || aiAnalyzeLoading} className="btn-shimmer text-black font-semibold gap-2 h-10 rounded-xl px-6">
                    {aiAnalyzeLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                    Analizar
                  </Button>
                </div>
                {aiResult && (
                  <div className={`rounded-xl p-5 text-sm leading-relaxed backdrop-blur-sm ${
                    aiResult.type === 'loading' ? 'bg-white/[0.02] text-slate-400 border border-white/[0.04]' :
                    aiResult.type === 'error' ? 'bg-red-500/[0.07] border border-red-500/20 text-red-300' :
                    aiResult.type === 'warn' ? 'bg-orange-500/[0.07] border border-orange-500/20 text-orange-300' :
                    'bg-white/[0.02] border border-white/[0.06] text-slate-200 whitespace-pre-wrap'
                  }`}>
                    {aiResult.type === 'loading' && <Loader2 className="w-4 h-4 animate-spin inline mr-2" />}
                    {aiResult.type === 'result' && <><Bot className="w-4 h-4 inline mr-2 text-amber-400" /><strong className="text-amber-400">Diagnóstico:</strong>{'\n\n'}{aiResult.text}</>}
                    {aiResult.type !== 'result' && aiResult.text}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Section 4: Learning */}
        {hasResults && (
          <section className="animate-fade-in-up animate-fade-in-up-4">
            <div className="flex items-center gap-3 mb-5">
              <SectionNumber n={4} />
              <div>
                <h2 className="text-base font-semibold text-white">Aprendizaje asistido por IA</h2>
                <p className="text-[11px] text-slate-500 mt-0.5">Expandí el diccionario de repuestos con ayuda de inteligencia artificial</p>
              </div>
            </div>
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="p-6 space-y-5">
                <p className="text-xs text-slate-400 leading-relaxed">
                  Tareas que piden un cambio de repuesto cuyo nombre no está en el diccionario.
                  La IA sugiere la categoría — revisá y decidí cuáles sumar al sistema.
                </p>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <Badge variant="outline" className="text-xs font-mono border-white/[0.08] text-slate-400 bg-white/[0.02]">
                    {unrecognizedTasks.length} tarea(s) sin categoría
                  </Badge>
                  <div className="flex gap-2 flex-wrap">
                    <Button variant="outline" size="sm" onClick={handleExportDict} className="text-xs gap-1.5 border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] rounded-xl">
                      <Download className="w-3.5 h-3.5" /> Exportar
                    </Button>
                    <label className="inline-flex items-center cursor-pointer">
                      <Button variant="outline" size="sm" className="text-xs gap-1.5 border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] rounded-xl pointer-events-none" asChild>
                        <span><Download className="w-3.5 h-3.5 rotate-180" /> Importar</span>
                      </Button>
                      <input type="file" accept=".json" onChange={handleImportDict} className="hidden" />
                    </label>
                    <Button size="sm" onClick={handleAnalyzeDict} disabled={!groqKey || unrecognizedTasks.length === 0 || aiDictLoading} className="btn-shimmer text-black font-semibold text-xs gap-1.5 rounded-xl">
                      {aiDictLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
                      Analizar con IA
                    </Button>
                  </div>
                </div>

                <ScrollArea className="h-[150px]">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-white/[0.04] hover:bg-transparent">
                        <TableHead className="bg-white/[0.02] text-slate-400 text-[10px] uppercase tracking-widest font-semibold">Tarea</TableHead>
                        <TableHead className="bg-white/[0.02] text-slate-400 text-[10px] uppercase tracking-widest font-semibold w-20">Qty</TableHead>
                        <TableHead className="bg-white/[0.02] text-slate-400 text-[10px] uppercase tracking-widest font-semibold w-24">Ej. OM</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unrecognizedTasks.length === 0 ? (
                        <TableRow><TableCell colSpan={3} className="text-center text-slate-500 text-xs py-8">Todas las tareas coinciden con alguna categoría.</TableCell></TableRow>
                      ) : unrecognizedTasks.map((u, i) => (
                        <TableRow key={i} className="border-white/[0.03] table-row-glow">
                          <TableCell className="font-mono text-xs text-slate-300">{esc(u.tarea)}</TableCell>
                          <TableCell className="font-mono text-xs text-amber-400 font-semibold">{u.count}</TableCell>
                          <TableCell className="font-mono text-xs text-slate-500">{esc(u.order)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>

                {suggestions.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-xs text-slate-300 font-medium flex items-center gap-2">
                      <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
                      <span className="bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent font-semibold">Sugerencias de la IA</span>
                      <span className="text-slate-500">— revisá antes de guardar</span>
                    </p>
                    {suggestions.map((s, i) => (
                      <SuggestionCard key={i} suggestion={s} index={i} onUpdate={(updated) => { setEditedSuggestions(prev => { const n = [...prev]; n[i] = updated; return n; }); }} />
                    ))}
                    <Button onClick={handleSaveSuggestions} className="btn-shimmer text-black font-semibold text-xs gap-1.5 rounded-xl mt-2">
                      Guardar seleccionadas
                    </Button>
                  </div>
                )}

                <Separator className="bg-white/[0.04]" />
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-slate-400 font-medium flex items-center gap-2">
                      <BookOpen className="w-3.5 h-3.5" /> Diccionario aprendido
                    </p>
                    <Button variant="ghost" size="sm" onClick={handleClearDict} className="text-xs text-slate-600 hover:text-red-400 gap-1">
                      <Trash2 className="w-3 h-3" /> Vaciar
                    </Button>
                  </div>
                  {Object.keys(customDict).length === 0 ? (
                    <p className="text-xs text-slate-600 italic">Sin categorías aprendidas todavía.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(customDict).map(([cat, syns]) => (
                        <Badge key={cat} className="bg-white/[0.03] border-white/[0.06] px-3 py-1.5 gap-2 text-xs rounded-xl hover:bg-white/[0.06] transition-colors">
                          <span className="font-bold text-amber-400 font-mono">{cat}</span>
                          <span className="text-slate-500 font-mono text-[10px]">{syns.join(', ')}</span>
                          <button onClick={() => handleDeleteDictEntry(cat)} className="text-slate-600 hover:text-red-400 font-bold ml-0.5 transition-colors">✕</button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
          </TabsContent>

          <TabsContent value="ov" className="mt-6">
            <OVTab
              groqKey={groqKey}
              groqModel={groqModel}
              onGroqKeyChange={setGroqKey}
              onGroqModelChange={setGroqModel}
            />
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="relative z-10 mt-auto">
        <div className="footer-line" />
        <div className="py-5">
          <p className="text-center text-[10px] text-slate-600/60 font-mono tracking-[0.2em] uppercase">
            Desarrollado para optimización y control logístico de flotas
          </p>
        </div>
      </footer>
    </div>
  );
}

/* =================== SUGGESTION CARD =================== */

function SuggestionCard({ suggestion, index, onUpdate }: { suggestion: AISuggestion; index: number; onUpdate: (updated: AISuggestion) => void }) {
  const [cat, setCat] = useState(up(suggestion.categoria || ''));
  const [syns, setSyns] = useState((suggestion.sinonimos || []).map(x => up(x)).join(', '));
  const [checked, setChecked] = useState(true);

  useEffect(() => {
    onUpdate({ ...suggestion, categoria: cat, sinonimos: syns.split(',').map(x => x.trim()).filter(Boolean) });
  }, [cat, syns]);

  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <div className="p-4">
        <p className="font-mono text-xs text-slate-400 mb-3 break-words">&quot;{esc(suggestion.tarea)}&quot;</p>
        <div className="grid grid-cols-[auto_1fr] gap-3 items-center">
          <Checkbox checked={checked} onCheckedChange={(v) => setChecked(!!v)} className="data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input value={cat} onChange={e => setCat(up(e.target.value))} placeholder="CATEGORÍA" className="font-mono text-xs bg-white/[0.03] border-white/[0.06] h-8 rounded-lg" />
            <Input value={syns} onChange={e => setSyns(e.target.value)} placeholder="Sinónimos separados por coma" className="font-mono text-xs bg-white/[0.03] border-white/[0.06] h-8 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}