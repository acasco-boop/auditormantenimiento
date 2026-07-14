'use client';

import React, { useState, useCallback, useMemo } from 'react';
import ExcelJS from 'exceljs';
import { Card, CardContent } from '@/components/ui/card';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Upload, FileSpreadsheet, Download, Bot, Brain,
  AlertTriangle, XCircle, CheckCircle2, BarChart3,
  Loader2, Search, Sparkles, ShoppingCart, ArrowLeftRight, Filter
} from 'lucide-react';
import type { OVRow, OVMatRow, OVFinding, AIMatchSuggestion } from '@/lib/ov-audit-engine';
import { runOVAudit, buildFuzzyMatchPrompt } from '@/lib/ov-audit-engine';
import { parseTabularFile, esc, thinBorder } from './shared-utils';

/* =================== OV HALLAZGO BADGE =================== */

function OVHallazgoBadge({ tipo }: { tipo: string }) {
  let cls = 'bg-orange-500/15 text-orange-400 border-orange-500/30';
  if (tipo.startsWith('1)')) cls = 'bg-amber-500/15 text-amber-400 border-amber-500/25';
  else if (tipo.startsWith('3)')) cls = 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25';
  const shortLabel = tipo.startsWith('1)') ? 'En OV no Mat' : tipo.startsWith('2)') ? 'En Mat no OV' : 'Dif. Cant.';
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg font-mono text-[10px] border ${cls}`}>
      {shortLabel}
    </span>
  );
}

/* =================== CONFIDENCE BADGE =================== */

function ConfidenceBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    'Alta': 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    'Media': 'bg-amber-500/15 text-amber-400 border-amber-500/25',
    'Baja': 'bg-red-500/15 text-red-400 border-red-500/25',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-lg font-mono text-[10px] border ${colors[level] || colors['Baja']}`}>
      {level}
    </span>
  );
}

/* =================== MAIN OV TAB =================== */

export default function OVTab() {
  const [dfOV, setDfOV] = useState<OVRow[] | null>(null);
  const [dfOVMat, setDfOVMat] = useState<OVMatRow[] | null>(null);
  const [ovFileName, setOvFileName] = useState<string | null>(null);
  const [ovMatFileName, setOvMatFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [filterOvta, setFilterOvta] = useState('');
  const [filterTipo, setFilterTipo] = useState('todos');

  // AI state
  const [aiMatchLoading, setAiMatchLoading] = useState(false);
  const [aiMatches, setAiMatches] = useState<AIMatchSuggestion[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);

  const auditOutput = useMemo(() => {
    if (!dfOV || !dfOVMat) return null;
    try { return runOVAudit(dfOV, dfOVMat); }
    catch (e) { setError(String((e as Error).message)); return null; }
  }, [dfOV, dfOVMat]);

  const findings = auditOutput?.findings || [];
  const metrics = auditOutput?.metrics;

  const handleFile = useCallback((file: File, setDf: (rows: Record<string, unknown>[]) => void, setFileName: (n: string) => void) => {
    setFileName(file.name); setError(null);
    parseTabularFile(file).then(rows => setDf(rows)).catch(e => setError(`Error al leer "${file.name}": ${(e as Error).message}`));
  }, []);
  const handleOVFile = useCallback((f: File) => handleFile(f, (rows) => setDfOV(rows as OVRow[]), setOvFileName), [handleFile]);
  const handleOVMatFile = useCallback((f: File) => handleFile(f, (rows) => setDfOVMat(rows as OVMatRow[]), setOvMatFileName), [handleFile]);

  // Filtered findings
  const filteredFindings = useMemo(() => {
    let filtered = findings;
    if (filterTipo !== 'todos') {
      filtered = filtered.filter(f => {
        if (filterTipo === '1') return f['Tipo de Hallazgo'].startsWith('1)');
        if (filterTipo === '2') return f['Tipo de Hallazgo'].startsWith('2)');
        if (filterTipo === '3') return f['Tipo de Hallazgo'].startsWith('3)');
        return true;
      });
    }
    if (filterOvta.trim()) {
      const ovtaUp = filterOvta.toUpperCase().trim();
      filtered = filtered.filter(f => String(f['Nro Ovta']).toUpperCase().includes(ovtaUp));
    }
    return filtered;
  }, [findings, filterTipo, filterOvta]);

  const uniqueOvtas = useMemo(() => [...new Set(findings.map(f => String(f['Nro Ovta'])))].sort((a, b) => Number(a) - Number(b)), [findings]);

  // Export
  const handleExportExcel = useCallback(async () => {
    if (findings.length === 0) return;
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('OV vs Materiales');
    const cols = ['Nro Ovta', 'Taller', 'Equipo', 'Artículo OV', 'Desc. OV', 'Cant. OV', 'Artículo Mat', 'Desc. Mat', 'Cant. Mat', 'Tipo de Hallazgo', 'Detalle'];
    ws.addRow(cols);
    findings.forEach(r => ws.addRow(cols.map(c => r[c as keyof OVFinding])));
    const headerRow = ws.getRow(1);
    headerRow.eachCell(cell => { cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F497D' } }; cell.alignment = { horizontal: 'center', vertical: 'middle' }; cell.border = thinBorder(); });
    for (let i = 0; i < findings.length; i++) {
      const rowIdx = i + 2; const row = ws.getRow(rowIdx);
      const hallazgo = String(findings[i]['Tipo de Hallazgo']);
      let fillColor = 'FFFCE4D6'; if (hallazgo.startsWith('1)')) fillColor = 'FFFFF2CC'; else if (hallazgo.startsWith('3)')) fillColor = 'FFE2EFDA';
      const altFill = rowIdx % 2 === 0 ? 'FFF9FAFB' : null;
      row.eachCell((cell, colNumber) => { cell.border = thinBorder(); if (colNumber === 10) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } }; else if (altFill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: altFill } }; cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: false }; });
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: findings.length + 1, column: cols.length } };
    ws.columns.forEach(col => { let maxLen = 10; col.eachCell({ includeEmpty: true }, cell => { const len = cell.value ? String(cell.value).length : 0; if (len > maxLen) maxLen = len; }); col.width = Math.min(maxLen + 3, 80); });
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = 'Auditoria_OV_vs_Materiales.xlsx';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }, [findings]);

  // AI fuzzy match
  const handleAIMatch = useCallback(async () => {
    if (findings.length === 0) return;
    const prompt = buildFuzzyMatchPrompt(findings);
    if (!prompt) { setAiError('No hay hallazgos tipo 1 o 2 para analizar con IA.'); return; }
    setAiMatchLoading(true); setAiError(null);
    try {
      const resp = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, temperature: 0.1, max_tokens: 4096 }),
      });
      const data = await resp.json();
      if (!resp.ok) { setAiError(data?.error?.message || 'Error de API'); setAiMatches([]); return; }
      let text = data.choices[0].message.content.trim();
      text = text.replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '').trim();
      const fb = text.indexOf('['), lb = text.lastIndexOf(']');
      if (fb !== -1 && lb > fb) text = text.substring(fb, lb + 1);
      text = text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/,\s*([}\]])/g, '$1');
      let parsed: AIMatchSuggestion[];
      try { parsed = JSON.parse(text); } catch { parsed = []; }
      setAiMatches(Array.isArray(parsed) ? parsed : []);
    } catch (e) { setAiError(String((e as Error).message)); setAiMatches([]); }
    finally { setAiMatchLoading(false); }
  }, [findings]);

  const hasFindings = findings.length > 0;

  return (
    <div className="space-y-8">

      {/* Section 1: Upload */}
      <section className="animate-fade-in-up animate-fade-in-up-1">
        <div className="flex items-center gap-3 mb-5">
          <div className="section-badge w-8 h-8 rounded-xl flex items-center justify-center text-cyan-400 text-sm font-bold font-mono shrink-0">1</div>
          <div>
            <h2 className="text-base font-semibold text-white">Cargar planillas OV & Materiales</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Compará artículos y cantidades entre la Orden de Venta y el registro de Materiales</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div
            className={`glass-card rounded-2xl cursor-pointer group animate-fade-in-up ${ovFileName ? 'gradient-border-cyan' : ''}`}
            onClick={() => document.getElementById('ov-file-input')?.click()}
          >
            <input id="ov-file-input" type="file" accept=".xlsx,.csv" onChange={e => { const f = e.target.files?.[0]; if (f) handleOVFile(f); }} className="hidden" />
            <div className="p-6 flex items-center gap-4">
              <div className={`upload-icon p-3.5 rounded-2xl transition-all duration-300 ${ovFileName ? 'bg-gradient-to-br from-cyan-500/20 to-blue-500/10 text-cyan-400 shadow-lg shadow-cyan-500/10' : 'bg-slate-800/60 text-slate-500 group-hover:text-cyan-400 group-hover:bg-slate-800/80'}`}>
                <ShoppingCart className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-semibold text-sm transition-colors ${ovFileName ? 'text-cyan-100' : 'text-slate-200 group-hover:text-white'}`}>Orden de Venta (Excel o CSV)</p>
                <p className="text-xs text-slate-500 mt-1">Columna requerida: Nro Ovta, Número de artículo, Cantidad</p>
                {ovFileName && (
                  <div className="flex items-center gap-2 mt-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <p className="text-xs text-emerald-400/80 font-mono truncate">{ovFileName}</p>
                  </div>
                )}
              </div>
              {!ovFileName && (
                <div className="p-2 rounded-xl bg-slate-800/40 text-slate-600 group-hover:text-cyan-400/50 group-hover:bg-cyan-500/5 transition-all">
                  <Upload className="w-4 h-4" />
                </div>
              )}
            </div>
          </div>

          <div
            className={`glass-card rounded-2xl cursor-pointer group animate-fade-in-up ${ovMatFileName ? 'gradient-border-cyan' : ''}`}
            onClick={() => document.getElementById('ovmat-file-input')?.click()}
          >
            <input id="ovmat-file-input" type="file" accept=".xlsx,.csv" onChange={e => { const f = e.target.files?.[0]; if (f) handleOVMatFile(f); }} className="hidden" />
            <div className="p-6 flex items-center gap-4">
              <div className={`upload-icon p-3.5 rounded-2xl transition-all duration-300 ${ovMatFileName ? 'bg-gradient-to-br from-cyan-500/20 to-blue-500/10 text-cyan-400 shadow-lg shadow-cyan-500/10' : 'bg-slate-800/60 text-slate-500 group-hover:text-cyan-400 group-hover:bg-slate-800/80'}`}>
                <FileSpreadsheet className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-semibold text-sm transition-colors ${ovMatFileName ? 'text-cyan-100' : 'text-slate-200 group-hover:text-white'}`}>Materiales (Excel o CSV)</p>
                <p className="text-xs text-slate-500 mt-1">Columna requerida: Nro Ovta, Artículo, Salidas</p>
                {ovMatFileName && (
                  <div className="flex items-center gap-2 mt-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <p className="text-xs text-emerald-400/80 font-mono truncate">{ovMatFileName}</p>
                  </div>
                )}
              </div>
              {!ovMatFileName && (
                <div className="p-2 rounded-xl bg-slate-800/40 text-slate-600 group-hover:text-cyan-400/50 group-hover:bg-cyan-500/5 transition-all">
                  <Upload className="w-4 h-4" />
                </div>
              )}
            </div>
          </div>
        </div>
        {error && (
          <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm flex items-center gap-3 backdrop-blur-sm">
            <div className="p-1.5 rounded-lg bg-red-500/20"><XCircle className="w-4 h-4" /></div>
            {error}
          </div>
        )}
      </section>

      {/* Section 2: Metrics */}
      {hasFindings && metrics && (
        <section className="animate-fade-in-up animate-fade-in-up-2">
          <div className="flex items-center gap-3 mb-5">
            <div className="section-badge w-8 h-8 rounded-xl flex items-center justify-center text-cyan-400 text-sm font-bold font-mono shrink-0">2</div>
            <div>
              <h2 className="text-base font-semibold text-white">Resumen de discrepancias OV vs Materiales</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">{findings.length} hallazgos en {uniqueOvtas.length} órdenes de venta</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {/* Metric 1: Total OVs */}
            <div className="glass-card rounded-2xl overflow-hidden gradient-border-cyan animate-fade-in-up-1">
              <div className="p-5 bg-gradient-to-br from-cyan-950/40 via-cyan-900/10 to-transparent">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Total OVs</p>
                <p className="text-3xl font-bold font-mono mt-2 text-cyan-400">{metrics.totalOVs}</p>
                <p className="text-[10px] text-slate-500 mt-2">{metrics.totalItemsOV} ítems materiales en OV</p>
              </div>
            </div>

            {/* Metric 2: OVs con discrepancia */}
            <div className="glass-card rounded-2xl overflow-hidden animate-fade-in-up-2" style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.08) 0%, transparent 60%)' }}>
              <div className="p-5">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">OVs con falla</p>
                <p className="text-3xl font-bold font-mono mt-2 text-red-400">{metrics.ovsConDiscrepancia}</p>
                <p className="text-[10px] text-slate-500 mt-2">{((metrics.ovsConDiscrepancia / Math.max(metrics.totalOVs, 1)) * 100).toFixed(1)}% del total</p>
              </div>
            </div>

            {/* Metric 3: En OV no Mat */}
            <div className="glass-card rounded-2xl overflow-hidden animate-fade-in-up-3">
              <div className="p-5 bg-gradient-to-br from-amber-950/40 via-amber-900/10 to-transparent">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">En OV no Mat</p>
                <p className="text-3xl font-bold font-mono mt-2 text-amber-400">{metrics.tiposHallazgo.find(t => t.name.startsWith('1)'))?.count || 0}</p>
                <p className="text-[10px] text-slate-500 mt-2">Facturados sin respaldo</p>
              </div>
            </div>

            {/* Metric 4: En Mat no OV */}
            <div className="glass-card rounded-2xl overflow-hidden animate-fade-in-up-4">
              <div className="p-5 bg-gradient-to-br from-orange-950/40 via-orange-900/10 to-transparent">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">En Mat no OV</p>
                <p className="text-3xl font-bold font-mono mt-2 text-orange-400">{metrics.tiposHallazgo.find(t => t.name.startsWith('2)'))?.count || 0}</p>
                <p className="text-[10px] text-slate-500 mt-2">Retirados sin facturar</p>
              </div>
            </div>
          </div>

          {/* Breakdowns */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {/* Por tipo de hallazgo */}
            <div className="glass-card rounded-2xl p-5">
              <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500/80 font-bold mb-3">Por tipo de hallazgo</p>
              <div className="flex flex-wrap gap-2">
                {metrics.tiposHallazgo.map(t => (
                  <Badge key={t.name} variant="outline" className={`text-xs font-mono px-3 py-1.5 ${
                    t.name.startsWith('1)') ? 'border-amber-500/25 text-amber-300 bg-amber-500/[0.07]' :
                    t.name.startsWith('2)') ? 'border-orange-500/25 text-orange-300 bg-orange-500/[0.07]' :
                    'border-emerald-500/25 text-emerald-300 bg-emerald-500/[0.07]'
                  }`}>
                    {t.name} <span className="ml-1 opacity-70">{t.count}</span>
                  </Badge>
                ))}
              </div>
            </div>

            {/* Por taller */}
            {metrics.porTaller.length > 0 && (
              <div className="glass-card rounded-2xl p-5">
                <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500/80 font-bold mb-3">Por taller</p>
                <div className="flex flex-wrap gap-2">
                  {metrics.porTaller.map(t => (
                    <Badge key={t.name} variant="outline" className="text-xs font-mono px-3 py-1.5 border-cyan-500/25 text-cyan-300 bg-cyan-500/[0.07]">
                      {t.name} <span className="ml-1 opacity-70">{t.count}</span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Section 3: Findings Table */}
      {hasFindings && (
        <section className="animate-fade-in-up animate-fade-in-up-3">
          <div className="flex items-center gap-3 mb-5">
            <div className="section-badge w-8 h-8 rounded-xl flex items-center justify-center text-cyan-400 text-sm font-bold font-mono shrink-0">3</div>
            <div>
              <h2 className="text-base font-semibold text-white">Detalle de hallazgos</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">{filteredFindings.length} registros (de {findings.length} totales)</p>
            </div>
          </div>

          <div className="glass-card rounded-2xl overflow-hidden">
            {/* Filters */}
            <div className="px-5 py-3 flex items-center gap-3 flex-wrap border-b border-white/[0.04]">
              <div className="flex items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-xs text-slate-400">Filtros:</span>
              </div>
              <Input
                placeholder="Buscar Nro Ovta..."
                value={filterOvta}
                onChange={e => setFilterOvta(e.target.value)}
                className="bg-white/[0.03] border-white/[0.06] font-mono text-xs h-8 rounded-lg w-36 focus:border-cyan-500/30"
              />
              <Select value={filterTipo} onValueChange={setFilterTipo}>
                <SelectTrigger className="bg-white/[0.03] border-white/[0.06] text-xs h-8 rounded-lg w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800/95 backdrop-blur-xl border-white/[0.08]">
                  <SelectItem value="todos">Todos los tipos</SelectItem>
                  <SelectItem value="1">En OV, no en Material</SelectItem>
                  <SelectItem value="2">En Material, no en OV</SelectItem>
                  <SelectItem value="3">Diferencia de cantidad</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex-1" />
              <Button size="sm" onClick={handleExportExcel} className="btn-shimmer text-black font-semibold text-xs gap-1.5 rounded-xl">
                <Download className="w-3.5 h-3.5" /> Descargar .xlsx
              </Button>
            </div>

            <ScrollArea className="h-[440px]">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/[0.04] hover:bg-transparent">
                    {['Nro Ovta', 'Taller', 'Art. OV', 'Desc. OV', 'Cant OV', 'Art. Mat', 'Desc. Mat', 'Cant Mat', 'Tipo', 'Detalle'].map((h, i) => (
                      <TableHead key={h} className={`bg-white/[0.02] text-slate-400 text-[10px] uppercase tracking-widest font-semibold whitespace-nowrap ${i === 1 ? 'hidden md:table-cell' : ''} ${i === 4 || i === 7 ? 'hidden lg:table-cell' : ''} ${i === 9 ? 'hidden xl:table-cell' : ''}`}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredFindings.map((f, i) => (
                    <TableRow key={i} className="border-white/[0.03] table-row-glow">
                      <TableCell className="font-mono text-xs text-cyan-300/80">{esc(f['Nro Ovta'])}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-500 hidden md:table-cell">{esc(f['Taller'])}</TableCell>
                      <TableCell className="font-mono text-xs text-amber-300/70">{esc(f['Artículo OV']) || <span className="text-slate-600">—</span>}</TableCell>
                      <TableCell className="text-xs text-slate-400 max-w-[180px] truncate" title={f['Desc. OV']}>{esc(f['Desc. OV']) || <span className="text-slate-600">—</span>}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-300 hidden lg:table-cell">{f['Cant. OV']}</TableCell>
                      <TableCell className="font-mono text-xs text-teal-300/70">{esc(f['Artículo Mat']) || <span className="text-slate-600">—</span>}</TableCell>
                      <TableCell className="text-xs text-slate-400 max-w-[180px] truncate" title={f['Desc. Mat']}>{esc(f['Desc. Mat']) || <span className="text-slate-600">—</span>}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-300 hidden lg:table-cell">{f['Cant. Mat']}</TableCell>
                      <TableCell><OVHallazgoBadge tipo={f['Tipo de Hallazgo']} /></TableCell>
                      <TableCell className="text-xs text-slate-500 max-w-[220px] truncate hidden xl:table-cell" title={f['Detalle']}>{esc(f['Detalle'])}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        </section>
      )}

      {/* Section 4: AI Fuzzy Match */}
      {hasFindings && (
        <section className="animate-fade-in-up animate-fade-in-up-4">
          <div className="flex items-center gap-3 mb-5">
            <div className="section-badge w-8 h-8 rounded-xl flex items-center justify-center text-cyan-400 text-sm font-bold font-mono shrink-0">4</div>
            <div>
              <h2 className="text-base font-semibold text-white">Cruce inteligente con IA</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">Buscá coincidencias probables entre artículos huérfanos usando IA</p>
            </div>
          </div>
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="p-6 space-y-5">
              <Button
                onClick={handleAIMatch}
                disabled={findings.length === 0 || aiMatchLoading}
                className="btn-shimmer text-black font-semibold text-xs gap-2 h-10 rounded-xl px-6"
              >
                {aiMatchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
                Buscar cruces probables con IA
              </Button>

              {aiError && (
                <div className="p-4 rounded-xl bg-red-500/[0.07] border border-red-500/20 text-red-300 text-sm">{aiError}</div>
              )}

              {aiMatches.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-300 font-medium flex items-center gap-2">
                    <ArrowLeftRight className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent font-semibold">
                      {aiMatches.length} cruces probables encontrados
                    </span>
                  </p>
                  <ScrollArea className="h-[250px]">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-white/[0.04] hover:bg-transparent">
                          <TableHead className="bg-white/[0.02] text-slate-400 text-[10px] uppercase tracking-widest font-semibold">Nro Ovta</TableHead>
                          <TableHead className="bg-white/[0.02] text-slate-400 text-[10px] uppercase tracking-widest font-semibold">Art. OV</TableHead>
                          <TableHead className="bg-white/[0.02] text-slate-400 text-[10px] uppercase tracking-widest font-semibold hidden md:table-cell">Desc. OV</TableHead>
                          <TableHead className="bg-white/[0.02] text-slate-400 text-[10px] uppercase tracking-widest font-semibold">Art. Mat</TableHead>
                          <TableHead className="bg-white/[0.02] text-slate-400 text-[10px] uppercase tracking-widest font-semibold hidden md:table-cell">Desc. Mat</TableHead>
                          <TableHead className="bg-white/[0.02] text-slate-400 text-[10px] uppercase tracking-widest font-semibold">Confianza</TableHead>
                          <TableHead className="bg-white/[0.02] text-slate-400 text-[10px] uppercase tracking-widest font-semibold hidden lg:table-cell">Razón</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {aiMatches.map((m, i) => (
                          <TableRow key={i} className="border-white/[0.03] table-row-glow">
                            <TableCell className="font-mono text-xs text-cyan-300/80">{esc(m.ovta)}</TableCell>
                            <TableCell className="font-mono text-xs text-amber-300/70">{esc(m.ovArticulo)}</TableCell>
                            <TableCell className="text-xs text-slate-400 max-w-[150px] truncate hidden md:table-cell" title={m.ovDesc}>{esc(m.ovDesc)}</TableCell>
                            <TableCell className="font-mono text-xs text-teal-300/70">{esc(m.matArticulo)}</TableCell>
                            <TableCell className="text-xs text-slate-400 max-w-[150px] truncate hidden md:table-cell" title={m.matDesc}>{esc(m.matDesc)}</TableCell>
                            <TableCell><ConfidenceBadge level={m.confidence} /></TableCell>
                            <TableCell className="text-xs text-slate-500 max-w-[200px] truncate hidden lg:table-cell" title={m.razon}>{esc(m.razon)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
              )}

              {aiMatchLoading && (
                <div className="flex items-center gap-3 text-sm text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                  Buscando cruces probables...
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}