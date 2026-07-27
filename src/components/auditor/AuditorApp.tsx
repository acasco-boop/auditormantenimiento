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
  Sparkles, Shield, Zap, ClipboardList, ShoppingCart,
  Settings, Eye, EyeOff
} from 'lucide-react';
import type { TareaRow, MaterialRow, OrdenRow, AuditResult, UnrecognizedTask, AISuggestion, MetricBreakdown } from '@/lib/audit-types';
import { runAudit, up, ACTION_WORDS } from '@/lib/audit-engine';
import { PARTS_TO_CHECK } from '@/lib/parts-dictionary';
import { requestOMCoherence, type CoherenceCheckResult } from '@/lib/ai-coherence';
import { parseTabularFile, esc, thinBorder } from './shared-utils';
import OVTab from './OVTab';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const CUSTOM_DICT_KEY = 'ommatcher_custom_dict_v1';

const stopWords = new Set(['DE', 'DEL', 'CON', 'SIN', 'POR', 'PARA', 'LOS', 'LAS', 'UNA', 'UNO', 'UNOS', 'UNAS', 'ESTE', 'ESTA', 'COMO', 'MAS', 'QUE', 'DELA']);
// Se reutiliza el mismo diccionario de verbos de acción que usa el motor de
// auditoría (audit-engine.ts) para que "Coloco", "Agregar", "Engrase", etc.
// se filtren de manera consistente en toda la app.
const actionWords = ACTION_WORDS;

function cleanSynonyms(syns: string[]): string[] {
  return (syns || [])
    .map(x => up(x))
    .filter(Boolean)
    .filter(syn => {
      const s = syn.trim();
      if (s.includes(' ')) return true; // Las frases compuestas son válidas
      if (s.length <= 2) return false;   // Descartar palabras cortas de 1 o 2 letras
      if (stopWords.has(s)) return false; // Descartar stop-words de la lista
      if (actionWords.has(s)) return false; // Descartar verbos de cambio genéricos
      return true;
    });
}

function findMatchingCategoryToMerge(cat: string, syns: string[], activeParts: Record<string, string[]>): string | null {
  const catUp = up(cat);
  const wordsInCat = catUp.split(/[^A-Z]/).filter(w => w.length >= 4);

  for (const existCat in activeParts) {
    const existCatUp = up(existCat);
    const existSyns = (activeParts[existCat] || []).map(s => up(s));
    
    for (const syn of [existCatUp, ...existSyns]) {
      if (syn.length < 4) continue;
      if (!syn.includes(' ')) {
        if (wordsInCat.includes(syn)) {
          return existCat;
        }
      } else {
        if (catUp.includes(syn)) {
          return existCat;
        }
      }
    }

    for (const s of syns) {
      const sUp = up(s);
      const wordsInS = sUp.split(/[^A-Z]/).filter(w => w.length >= 4);
      for (const syn of [existCatUp, ...existSyns]) {
        if (syn.length < 4) continue;
        if (!syn.includes(' ')) {
          if (wordsInS.includes(syn)) {
            return existCat;
          }
        } else {
          if (sUp.includes(syn)) {
            return existCat;
          }
        }
      }
    }
  }
  return null;
}

function migrateAndMergeDict(dict: Record<string, string[]>, baseParts: Record<string, string[]>): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  const baseKeys = Object.keys(baseParts);
  
  // Limpiar llaves y sinónimos primero (elimina "DE", "Y", etc. del diccionario cargado)
  Object.keys(dict).forEach(key => {
    const keyUp = up(key);
    if (!keyUp) return;
    merged[keyUp] = cleanSynonyms(dict[key]);
  });
  
  const customKeys = Object.keys(merged);
  customKeys.forEach(key => {
    const keyUp = up(key);
    let targetCat: string | null = null;
    
    for (const baseKey of baseKeys) {
      if (baseKey === key) continue;
      const baseKeyUp = up(baseKey);
      const baseSyns = (baseParts[baseKey] || []).map(s => up(s));
      const wordsInKey = keyUp.split(/[^A-Z]/).filter(w => w.length >= 4);
      
      for (const syn of [baseKeyUp, ...baseSyns]) {
        if (syn.length < 4) continue;
        if (!syn.includes(' ')) {
          if (wordsInKey.includes(syn)) {
            targetCat = baseKey;
            break;
          }
        } else {
          if (keyUp.includes(syn)) {
            targetCat = baseKey;
            break;
          }
        }
      }
      if (targetCat) break;
    }
    
    if (targetCat) {
      const synsToMerge = merged[key] || [];
      merged[targetCat] = [...new Set([...(merged[targetCat] || baseParts[targetCat] || []), ...synsToMerge, key])];
      delete merged[key];
    }
  });
  
  return merged;
}

function loadCustomDict(): Record<string, string[]> {
  if (typeof window === 'undefined') return {};
  try {
    const r = localStorage.getItem(CUSTOM_DICT_KEY);
    if (!r) return {};
    const parsed = JSON.parse(r);
    const migrated = migrateAndMergeDict(parsed, PARTS_TO_CHECK);
    localStorage.setItem(CUSTOM_DICT_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return {};
  }
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
  const [selectedOrder, setSelectedOrder] = useState('');
  
  // SAP Connection States
  const [dataSource, setDataSource] = useState<'excel' | 'sap'>('excel');
  const [sapUrl, setSapUrl] = useState('https://tuservidor:50000/b1s/v1');
  const [sapCompany, setSapCompany] = useState('');
  const [sapUser, setSapUser] = useState('');
  const [sapPass, setSapPass] = useState('');
  const [queryTar, setQueryTar] = useState('Q_TAREAS');
  const [queryMat, setQueryMat] = useState('Q_MATERIALES');
  const [queryOrd, setQueryOrd] = useState('Q_ORDENES');
  const [sapLoading, setSapLoading] = useState(false);
  const [aiResult, setAiResult] = useState<{ type: 'loading' | 'result' | 'error' | 'warn'; text: string } | null>(null);
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [editedSuggestions, setEditedSuggestions] = useState<AISuggestion[]>([]);
  const [aiDictLoading, setAiDictLoading] = useState(false);
  const [aiAnalyzeLoading, setAiAnalyzeLoading] = useState(false);

  // Control avanzado de IA: coherencia estructurada (JSON) Tarea <-> Material por OM.
  // Se cachean los resultados por Nro. de Orden para no re-consultar la IA innecesariamente.
  const [coherenceResults, setCoherenceResults] = useState<Record<string, CoherenceCheckResult>>({});
  const [coherenceError, setCoherenceError] = useState<string | null>(null);
  const [coherenceLoading, setCoherenceLoading] = useState(false);

  // Reporte de Cierres OK States
  const [closingSearch, setClosingSearch] = useState('');
  const [closingTypeFilter, setClosingTypeFilter] = useState<'ALL' | 'WITH_MAT' | 'WITHOUT_MAT'>('ALL');

  // AI Configuration States
  const [aiProvider, setAiProvider] = useState<'groq' | 'mimo' | 'lightning'>(() => {
    if (typeof window !== 'undefined') return (localStorage.getItem('ai_provider_v1') as any) || 'groq';
    return 'groq';
  });

  const [groqApiKey, setGroqApiKey] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('groq_api_key_v1') || '';
    return '';
  });
  const [groqModel, setGroqModel] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('groq_model_v1') || 'llama-3.3-70b-versatile';
    return 'llama-3.3-70b-versatile';
  });

  const [mimoApiKey, setMimoApiKey] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('mimo_api_key_v1') || '';
    return '';
  });
  const [mimoModel, setMimoModel] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('mimo_model_v1') || 'mimo-v2.5-pro';
    return 'mimo-v2.5-pro';
  });
  const [mimoBaseUrl, setMimoBaseUrl] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('mimo_base_url_v1') || 'https://token-plan-sgp.xiaomimimo.com/v1';
    return 'https://token-plan-sgp.xiaomimimo.com/v1';
  });

  const [lightningApiKey, setLightningApiKey] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('lightning_api_key_v1') || '';
    return '';
  });
  const [lightningModel, setLightningModel] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('lightning_model_v1') || 'anthropic/claude-fable-5';
    return 'anthropic/claude-fable-5';
  });
  const [lightningBaseUrl, setLightningBaseUrl] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('lightning_base_url_v1') || 'https://lightning.ai/api/v1';
    return 'https://lightning.ai/api/v1';
  });

  const [ollamaModel, setOllamaModel] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('ollama_model_v1') || 'gemma2';
    return 'gemma2';
  });
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('ollama_base_url_v1') || 'http://localhost:11434/v1';
    return 'http://localhost:11434/v1';
  });

  const [showSettings, setShowSettings] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const updateAiProvider = (prov: 'groq' | 'mimo' | 'lightning' | 'ollama') => {
    setAiProvider(prov);
    if (typeof window !== 'undefined') localStorage.setItem('ai_provider_v1', prov);
  };
  const updateGroqApiKey = (key: string) => {
    setGroqApiKey(key);
    if (typeof window !== 'undefined') localStorage.setItem('groq_api_key_v1', key);
  };
  const updateGroqModel = (model: string) => {
    setGroqModel(model);
    if (typeof window !== 'undefined') localStorage.setItem('groq_model_v1', model);
  };
  const updateMimoApiKey = (key: string) => {
    setMimoApiKey(key);
    if (typeof window !== 'undefined') localStorage.setItem('mimo_api_key_v1', key);
  };
  const updateMimoModel = (model: string) => {
    setMimoModel(model);
    if (typeof window !== 'undefined') localStorage.setItem('mimo_model_v1', model);
  };
  const updateMimoBaseUrl = (url: string) => {
    setMimoBaseUrl(url);
    if (typeof window !== 'undefined') localStorage.setItem('mimo_base_url_v1', url);
  };
  const updateLightningApiKey = (key: string) => {
    setLightningApiKey(key);
    if (typeof window !== 'undefined') localStorage.setItem('lightning_api_key_v1', key);
  };
  const updateLightningModel = (model: string) => {
    setLightningModel(model);
    if (typeof window !== 'undefined') localStorage.setItem('lightning_model_v1', model);
  };
  const updateLightningBaseUrl = (url: string) => {
    setLightningBaseUrl(url);
    if (typeof window !== 'undefined') localStorage.setItem('lightning_base_url_v1', url);
  };
  const updateOllamaModel = (model: string) => {
    setOllamaModel(model);
    if (typeof window !== 'undefined') localStorage.setItem('ollama_model_v1', model);
  };
  const updateOllamaBaseUrl = (url: string) => {
    setOllamaBaseUrl(url);
    if (typeof window !== 'undefined') localStorage.setItem('ollama_base_url_v1', url);
  };

  const activeApiKey = aiProvider === 'groq' ? groqApiKey : aiProvider === 'mimo' ? mimoApiKey : aiProvider === 'lightning' ? lightningApiKey : 'ollama';
  const activeModel = aiProvider === 'groq' ? groqModel : aiProvider === 'mimo' ? mimoModel : aiProvider === 'lightning' ? lightningModel : ollamaModel;
  const activeBaseUrl = aiProvider === 'mimo' ? mimoBaseUrl : aiProvider === 'lightning' ? lightningBaseUrl : aiProvider === 'ollama' ? ollamaBaseUrl : '';

  const auditOutput = React.useMemo(() => {
    if (!dfTar || !dfMat) return null;
    try { return runAudit(dfTar, dfMat, customDict, dfOrd); }
    catch (e) { setError(String((e as Error).message)); return null; }
  }, [dfTar, dfMat, customDict, dfOrd]);

  const results = auditOutput?.results || [];
  const unrecognizedTasks = auditOutput?.unrecognizedTasks || [];
  const metrics = auditOutput?.metrics || { c1: 0, c2: 0, c3: 0, b1: { taskCount: 0, uniqueOMs: 0, warehouses: [], tiposOrden: [] }, b2: { taskCount: 0, uniqueOMs: 0, warehouses: [], tiposOrden: [] }, b3: { taskCount: 0, uniqueOMs: 0, warehouses: [], tiposOrden: [] } };
  const uniqueOrders = [...new Set(results.map(r => String(r['Nro. Orden'])))];

  const closingReport = React.useMemo(() => {
    if (!dfTar) return [];

    // Agrupar tareas por Orden (DocNum o Nro. Orden)
    const tasksByOrder: Record<string, TareaRow[]> = {};
    dfTar.forEach(t => {
      const order = String(t['Nro. Orden'] || t['DocNum'] || '');
      if (!order) return;
      if (!tasksByOrder[order]) tasksByOrder[order] = [];
      tasksByOrder[order].push(t);
    });

    // Guardar las órdenes con discrepancias para excluirlas
    const findingsByOrder = new Set(results.map(r => String(r['Nro. Orden'])));

    // Materiales cargados por orden
    const matByOrder = auditOutput?.matByOrder || {};

    // Agrupar metadatos de órdenes de dfOrd
    const ordByOrder: Record<string, {
      tipoOrden: string;
      centrosCostos: string;
      contabilizada: string;
      fechaOrden: string;
      statusDoc: string;
    }> = {};

    const formatDate = (val: any): string => {
      if (!val) return '';
      const str = String(val).trim();
      const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        return `${match[3]}/${match[2]}/${match[1]}`;
      }
      const parsed = Date.parse(str);
      if (!isNaN(parsed)) {
        const dateObj = new Date(parsed);
        const d = dateObj.getDate().toString().padStart(2, '0');
        const m = (dateObj.getMonth() + 1).toString().padStart(2, '0');
        const y = dateObj.getFullYear();
        return `${d}/${m}/${y}`;
      }
      return str;
    };

    if (dfOrd && dfOrd.length > 0) {
      dfOrd.forEach(r => {
        const key = String(r['Nro. orden'] ?? '');
        if (!key) return;
        if (!ordByOrder[key]) {
          ordByOrder[key] = {
            tipoOrden: String(r['Tipo de orden'] || '').trim(),
            centrosCostos: String(r['Centos de costos'] || '').trim(),
            contabilizada: String(r['Contabilizada'] || '').trim(),
            fechaOrden: formatDate(r['Fecha de la orden']),
            statusDoc: String(r['Status de documento'] || '').trim(),
          };
        }
      });
    }

    const report: Array<{
      order: string;
      equipo: string;
      nombreEquipo: string;
      tipo: 'Con Materiales' | 'Sin Materiales (Solo Servicio/Control)';
      tasks: Array<{ tarea: string; estado: string; requiereMaterial: boolean }>;
      materials: Array<{ desc: string; salidas: number }>;
      tipoOrden?: string;
      centrosCostos?: string;
      contabilizada?: string;
      fechaOrden?: string;
      statusDoc?: string;
    }> = [];

    Object.entries(tasksByOrder).forEach(([order, oTasks]) => {
      // Si la orden tiene observaciones/desconexiones en resultados, no califica para cierre exitoso
      if (findingsByOrder.has(order)) return;

      const parsedTasks = oTasks.map(t => {
        const tarea = String(t['Tarea'] || '');
        const tareaUp = up(tarea);
        const reqMat = explicitReplacementNeeded(tareaUp);
        const estado = String(t['Estado'] || '').trim();
        // Verificar si está en un estado terminado/completo
        const isTerminada = ['TERMINADA', 'TERMINADO', 'CERRADA', 'CERRADO', 'COMPLETO', 'COMPLETA'].includes(estado.toUpperCase());
        return { tarea, estado, requiereMaterial: reqMat, isTerminada };
      });

      // Todas las tareas asignadas a la orden de mantenimiento deben estar completadas
      const allTasksTerminadas = parsedTasks.every(t => t.isTerminada);
      if (!allTasksTerminadas) return;

      const oMats = matByOrder[order] || [];
      const hasMaterials = oMats.length > 0;
      const hasTaskWithMaterial = parsedTasks.some(t => t.requiereMaterial);

      let tipo: 'Con Materiales' | 'Sin Materiales (Solo Servicio/Control)';
      if (hasTaskWithMaterial) {
        tipo = 'Con Materiales';
        // Debe tener algún material cargado y con salidas físicas reales > 0
        if (!hasMaterials) return;
        const totalSalidas = oMats.reduce((sum, m) => sum + parseFloat(String(m['Salidas'] || 0)), 0);
        if (totalSalidas === 0) return;
      } else {
        tipo = 'Sin Materiales (Solo Servicio/Control)';
      }

      const firstTask = oTasks[0];
      const ordData = ordByOrder[order];

      report.push({
        order,
        equipo: String(firstTask['Codigo equipo'] || ''),
        nombreEquipo: String(firstTask['Nombre Equipo'] || ''),
        tipo,
        tasks: parsedTasks.map(pt => ({ tarea: pt.tarea, estado: pt.estado, requiereMaterial: pt.requiereMaterial })),
        materials: oMats.map(m => ({ desc: String(m['Desc. Artículo'] || ''), salidas: parseFloat(String(m['Salidas'] || 0)) })),
        tipoOrden: ordData?.tipoOrden,
        centrosCostos: ordData?.centrosCostos,
        contabilizada: ordData?.contabilizada,
        fechaOrden: ordData?.fechaOrden,
        statusDoc: ordData?.statusDoc,
      });
    });

    return report;
  }, [dfTar, results, auditOutput, dfOrd]);

  const filteredClosingReport = React.useMemo(() => {
    return closingReport.filter(r => {
      const matchesSearch = r.order.includes(closingSearch) || 
                            r.equipo.toUpperCase().includes(closingSearch.toUpperCase()) || 
                            r.nombreEquipo.toUpperCase().includes(closingSearch.toUpperCase());
      
      const matchesType = closingTypeFilter === 'ALL' ||
                          (closingTypeFilter === 'WITH_MAT' && r.tipo === 'Con Materiales') ||
                          (closingTypeFilter === 'WITHOUT_MAT' && r.tipo === 'Sin Materiales (Solo Servicio/Control)');
                          
      return matchesSearch && matchesType;
    });
  }, [closingReport, closingSearch, closingTypeFilter]);

  const analyzedTasksRef = useRef<Set<string>>(new Set());

  // Reset analyzed tasks cache when new files are uploaded
  useEffect(() => {
    analyzedTasksRef.current.clear();
  }, [tarFileName, matFileName, ordFileName]);

  // Auto-analyze and save unrecognized tasks in the background when files are loaded
  useEffect(() => {
    if (unrecognizedTasks.length === 0 || !activeApiKey || aiDictLoading) return;

    // Filter tasks that haven't been analyzed in this session
    const tasksToAnalyze = unrecognizedTasks.filter(u => !analyzedTasksRef.current.has(up(u.tarea)));
    if (tasksToAnalyze.length === 0) return;

    const autoAnalyze = async () => {
      setAiDictLoading(true);
      
      // Mark as analyzed immediately to prevent double submissions
      tasksToAnalyze.forEach(u => analyzedTasksRef.current.add(up(u.tarea)));

      // Process a batch of up to 15 tasks to avoid hitting payload or rate limits
      const batch = tasksToAnalyze.slice(0, 15);
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
        const resp = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, temperature: 0.1, max_tokens: 4096, apiKey: activeApiKey, model: activeModel, provider: aiProvider, baseUrl: activeBaseUrl })
        });
        const data = await resp.json();
        if (!resp.ok) return;

        let text = data.choices[0].message.content.trim();
        text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim().replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '').trim();
        const fb = text.indexOf('['), lb = text.lastIndexOf(']');
        if (fb !== -1 && lb > fb) text = text.substring(fb, lb + 1);
        text = text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/,\s*([}\]])/g, '$1');
        const ob = (text.match(/\{/g) || []).length, cb = (text.match(/\}/g) || []).length, bra = (text.match(/\[/g) || []).length, bra2 = (text.match(/\]/g) || []).length;
        if (cb < ob || bra2 < bra) { text = text.replace(/,\s*$/, ''); text += '}'.repeat(ob - cb) + ']'.repeat(bra - bra2); }
        let parsed: AISuggestion[];
        try { parsed = JSON.parse(text); } catch { parsed = []; }

        if (Array.isArray(parsed) && parsed.length > 0) {
          const newDict = { ...customDict };
          let added = false;
          parsed.forEach(s => {
            if (!s || !s.categoria) return;
            const cat = up(s.categoria);
            const syns = cleanSynonyms(s.sinonimos);
            if (!cat) return;
            newDict[cat] = [...new Set([...(newDict[cat] || PARTS_TO_CHECK[cat] || []), ...syns, cat])];
            added = true;
          });

          if (added) {
            const migrated = migrateAndMergeDict(newDict, PARTS_TO_CHECK);
            setCustomDict(migrated);
            saveCustomDict(migrated);
          }
        }
      } catch (e) {
        console.error("Error auto-analyzing dictionary:", e);
      } finally {
        setAiDictLoading(false);
      }
    };

    autoAnalyze();
  }, [unrecognizedTasks, activeApiKey, activeModel, customDict, aiProvider, activeBaseUrl]);

  const handleFile = useCallback((file: File, setDf: (rows: Record<string, unknown>[]) => void, setFileName: (n: string) => void) => {
    setFileName(file.name); setError(null);
    parseTabularFile(file).then(rows => setDf(rows)).catch(e => setError(`Error al leer "${file.name}": ${(e as Error).message}`));
  }, []);
  const handleTarFile = useCallback((f: File) => handleFile(f, (rows) => setDfTar(rows as TareaRow[]), setTarFileName), [handleFile]);
  const handleMatFile = useCallback((f: File) => handleFile(f, (rows) => setDfMat(rows as MaterialRow[]), setMatFileName), [handleFile]);
  const handleOrdFile = useCallback((f: File) => handleFile(f, (rows) => setDfOrd(rows as OrdenRow[]), setOrdFileName), [handleFile]);

  const handleSapSync = useCallback(async () => {
    setSapLoading(true); setError(null);
    try {
      const loginRes = await fetch('/api/sap/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: sapUrl, companyDB: sapCompany, userName: sapUser, password: sapPass }) });
      const loginData = await loginRes.json();
      if (!loginRes.ok) throw new Error(loginData.error || 'Login failed');
      
      const fetchQuery = async (qid: string) => {
        const res = await fetch('/api/sap/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: sapUrl, sessionId: loginData.sessionId, queryId: qid }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Query ${qid} failed`);
        return data.value;
      };

      const [tarData, matData, ordData] = await Promise.all([
        fetchQuery(queryTar),
        fetchQuery(queryMat),
        fetchQuery(queryOrd)
      ]);

      setDfTar(tarData as TareaRow[]);
      setDfMat(matData as MaterialRow[]);
      setDfOrd(ordData as OrdenRow[]);
      setTarFileName(`SAP Query: ${queryTar}`);
      setMatFileName(`SAP Query: ${queryMat}`);
      setOrdFileName(`SAP Query: ${queryOrd}`);
    } catch (e: any) {
      setError(`Error de SAP: ${e.message}`);
    } finally {
      setSapLoading(false);
    }
  }, [sapUrl, sapCompany, sapUser, sapPass, queryTar, queryMat, queryOrd]);

  const handleExportExcel = useCallback(async () => {
    if (results.length === 0) return;
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Auditoría');
    const cols = [
      'Nro. Orden', 'Tipo de orden', 'Centros de costos', 
      'Contabilizada', 'Fecha de la orden', 'Status de documento', 
      'Equipo', 'Nombre Equipo', 'Tarea', 'Estado Tarea', 
      'Tipo de Hallazgo', 'Detalle'
    ];
    ws.addRow(cols); results.forEach(r => ws.addRow(cols.map(c => r[c as keyof AuditResult])));
    const headerRow = ws.getRow(1);
    headerRow.eachCell(cell => { cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F497D' } }; cell.alignment = { horizontal: 'center', vertical: 'middle' }; cell.border = thinBorder(); });
    
    const tareaColIdx = cols.indexOf('Tarea') + 1;
    const centerAlignCols = [
      cols.indexOf('Nro. Orden') + 1,
      cols.indexOf('Tipo de orden') + 1,
      cols.indexOf('Contabilizada') + 1,
      cols.indexOf('Fecha de la orden') + 1,
      cols.indexOf('Status de documento') + 1,
      cols.indexOf('Estado Tarea') + 1
    ];

    for (let i = 0; i < results.length; i++) {
      const rowIdx = i + 2; const row = ws.getRow(rowIdx);
      const hallazgo = String(results[i]['Tipo de Hallazgo']);
      let fillColor = 'FFFCE4D6'; if (hallazgo.startsWith('1)')) fillColor = 'FFFFF2CC'; else if (hallazgo.startsWith('3)')) fillColor = 'FFE2EFDA';
      const altFill = rowIdx % 2 === 0 ? 'FFF9FAFB' : null;
      
      row.eachCell((cell, colNumber) => { 
        cell.border = thinBorder(); 
        if (colNumber === tareaColIdx) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } }; 
        } else if (altFill) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: altFill } }; 
        }
        if (centerAlignCols.includes(colNumber)) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' }; 
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: false }; 
        }
      });
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: results.length + 1, column: cols.length } };
    ws.columns.forEach(col => { let maxLen = 10; col.eachCell({ includeEmpty: true }, cell => { const len = cell.value ? String(cell.value).length : 0; if (len > maxLen) maxLen = len; }); col.width = Math.min(maxLen + 3, 80); });
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = 'Auditoria_Mantenimiento_Generado.xlsx';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }, [results]);

  const handleExportClosingExcel = useCallback(async () => {
    if (closingReport.length === 0) return;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Órdenes OK Cierre');
    const cols = [
      'Nro. Orden', 'Tipo de orden', 'Centros de costos', 
      'Contabilizada', 'Fecha de la orden', 'Status de documento', 
      'Equipo', 'Nombre Equipo', 'Tipo de Cierre', 'Tareas', 'Materiales Consumidos'
    ];
    ws.addRow(cols);
    
    closingReport.forEach(r => {
      const taskStr = r.tasks.map(t => `${t.tarea} (${t.estado})`).join(' | ');
      const matStr = r.materials.map(m => `${m.desc} (Cant: ${m.salidas})`).join(' | ');
      ws.addRow([
        r.order,
        r.tipoOrden || '',
        r.centrosCostos || '',
        r.contabilizada || '',
        r.fechaOrden || '',
        r.statusDoc || '',
        r.equipo,
        r.nombreEquipo,
        r.tipo,
        taskStr,
        matStr
      ]);
    });
    
    const headerRow = ws.getRow(1);
    headerRow.eachCell(cell => {
      cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F497D' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = thinBorder();
    });

    const centerAlignCols = [1, 2, 4, 5, 6, 7, 9];
    for (let i = 0; i < closingReport.length; i++) {
      const rowIdx = i + 2;
      const row = ws.getRow(rowIdx);
      const altFill = rowIdx % 2 === 0 ? 'FFF9FAFB' : null;
      
      row.eachCell((cell, colIdx) => {
        cell.font = { name: 'Arial', size: 10 };
        cell.border = thinBorder();
        
        if (centerAlignCols.includes(colIdx)) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: false };
        }
        
        if (colIdx === 9) { // Tipo de Cierre
          const typeVal = String(cell.value);
          if (typeVal.startsWith('Con')) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
            cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF375623' } };
          } else {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
            cell.font = { name: 'Arial', size: 10, color: { argb: 'FF595959' } };
          }
        } else if (altFill) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: altFill } };
        }
      });
    }

    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: closingReport.length + 1, column: cols.length } };
    
    ws.columns.forEach(column => {
      let maxLen = 0;
      column.eachCell!({ includeEmpty: true }, cell => {
        const valStr = cell.value ? String(cell.value) : '';
        if (valStr.length > maxLen) maxLen = valStr.length;
      });
      column.width = Math.min(Math.max(maxLen + 3, 10), 50);
    });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Ordenes_OK_para_Cierre_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [closingReport]);

  const handleAnalyzeIA = useCallback(async () => {
    const fila = results.find(r => String(r['Nro. Orden']) === selectedOrder);
    if (!fila) { setAiResult({ type: 'error', text: 'No se encontró la orden seleccionada.' }); return; }
    if (!activeApiKey) {
      setAiResult({ type: 'warn', text: 'Por favor, configurá tu API Key de IA en la sección "Configurar IA" al principio de la página.' });
      setShowSettings(true);
      return;
    }
    setAiResult({ type: 'loading', text: 'Analizando desvío de taller con la IA...' }); setAiAnalyzeLoading(true);
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
      const resp = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, temperature: 0.3, apiKey: activeApiKey, model: activeModel, provider: aiProvider, baseUrl: activeBaseUrl })
      });
      const data = await resp.json();
      if (!resp.ok) { const msg = data?.error || JSON.stringify(data); setAiResult({ type: 'error', text: `Error: ${msg}` }); }
      else { setAiResult({ type: 'result', text: data.choices[0].message.content }); }
    } catch (e) { setAiResult({ type: 'error', text: `Error: ${(e as Error).message}` }); }
    finally { setAiAnalyzeLoading(false); }
  }, [selectedOrder, results, activeApiKey, activeModel, aiProvider, activeBaseUrl]);

  // Control avanzado de IA (JSON estructurado): evalúa si las tareas y los
  // materiales de la OM seleccionada son coherentes entre sí, devolviendo
  // { coherente, discrepancia_detectada, sugerencia_control }.
  const handleCoherenceCheck = useCallback(async () => {
    if (!selectedOrder || !dfTar || !auditOutput) return;
    if (!activeApiKey) {
      setCoherenceError('Por favor, configurá tu API Key de IA en la sección "Configurar IA" al principio de la página.');
      setShowSettings(true);
      return;
    }
    setCoherenceError(null);
    setCoherenceLoading(true);
    try {
      // Todas las tareas registradas para esta OM (no solo las que generaron un hallazgo).
      const tareasOM = dfTar
        .filter(t => String(t['Nro. Orden']) === selectedOrder)
        .map(t => ({ tarea: String(t['Tarea'] || ''), estado: String(t['Estado'] || '') }))
        .filter(t => t.tarea);
      const materialesOM = auditOutput.matByOrder[selectedOrder] || [];

      const result = await requestOMCoherence({
        order: selectedOrder,
        tareas: tareasOM,
        materiales: materialesOM,
        apiKey: activeApiKey,
        model: activeModel,
        provider: aiProvider,
        baseUrl: activeBaseUrl,
      });
      setCoherenceResults(prev => ({ ...prev, [selectedOrder]: result }));
    } catch (e) {
      setCoherenceError((e as Error).message);
    } finally {
      setCoherenceLoading(false);
    }
  }, [selectedOrder, dfTar, auditOutput, activeApiKey, activeModel, aiProvider, activeBaseUrl]);

  const handleAnalyzeDict = useCallback(async () => {
    if (unrecognizedTasks.length === 0) return;
    if (!activeApiKey) {
      setError('Por favor, configurá tu API Key de IA antes de usar la IA para el diccionario.');
      setShowSettings(true);
      return;
    }
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
      const resp = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, temperature: 0.1, max_tokens: 4096, apiKey: activeApiKey, model: activeModel, provider: aiProvider, baseUrl: activeBaseUrl })
      });
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
  }, [unrecognizedTasks, activeApiKey, activeModel, aiProvider, activeBaseUrl]);

  const handleSaveSuggestions = useCallback(() => {
    const newDict = { ...customDict };
    const toSave = editedSuggestions.length > 0 ? editedSuggestions : suggestions;
    toSave.forEach(s => { const cat = up(s.categoria); const syns = cleanSynonyms(s.sinonimos); if (!cat) return; newDict[cat] = [...new Set([...(newDict[cat] || PARTS_TO_CHECK[cat] || []), ...syns, cat])]; });
    const migrated = migrateAndMergeDict(newDict, PARTS_TO_CHECK);
    setCustomDict(migrated); saveCustomDict(migrated); setSuggestions([]); setEditedSuggestions([]);
  }, [editedSuggestions, suggestions, customDict]);

  const handleDeleteDictEntry = useCallback((cat: string) => { const d = { ...customDict }; delete d[cat]; setCustomDict(d); saveCustomDict(d); }, [customDict]);
  const handleExportDict = useCallback(() => { const b = new Blob([JSON.stringify(customDict, null, 2)], { type: 'application/json' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'diccionario_repuestos_aprendido.json'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u); }, [customDict]);
  const handleImportDict = useCallback((e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (!f) return; f.text().then(t => { try { const imp = JSON.parse(t); const nd = { ...customDict }; Object.keys(imp).forEach(c => { const cu = up(c); nd[cu] = [...new Set([...(nd[cu] || []), ...(imp[c] || []).map((x: string) => up(x))])]; }); const migrated = migrateAndMergeDict(nd, PARTS_TO_CHECK); setCustomDict(migrated); saveCustomDict(migrated); } catch { /* */ } }); e.target.value = ''; }, [customDict]);
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
        {/* Settings Toggle Bar */}
        <div className="flex justify-end mb-4 animate-fade-in-up">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSettings(!showSettings)}
            className="text-xs gap-1.5 border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] rounded-xl px-4 py-2 h-auto"
          >
            <Settings className={`w-3.5 h-3.5 ${showSettings ? 'animate-spin' : ''} text-amber-400`} />
            <span>Configurar IA</span>
          </Button>
        </div>

        {showSettings && (
          <div className="glass-card rounded-2xl p-5 mb-6 border border-amber-500/20 shadow-lg shadow-amber-500/5 animate-fade-in-up">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
                <Settings className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Configuración de Inteligencia Artificial</h3>
                <p className="text-[11px] text-slate-500">Configurá tu proveedor, API key y modelo para realizar diagnósticos y sugerencias</p>
              </div>
            </div>

            {/* Provider Selection */}
            <div className="mb-4 space-y-2 max-w-xs">
              <Label className="text-xs text-slate-400">Proveedor de IA</Label>
              <Select value={aiProvider} onValueChange={(val: any) => updateAiProvider(val)}>
                <SelectTrigger className="bg-white/[0.03] border-white/[0.06] text-xs h-9 rounded-xl text-amber-100">
                  <SelectValue placeholder="Seleccioná un proveedor de IA..." />
                </SelectTrigger>
                <SelectContent className="bg-slate-950/95 backdrop-blur-2xl border-white/[0.08] text-slate-200">
                  <SelectItem value="groq">Groq (Llama)</SelectItem>
                  <SelectItem value="mimo">Xiaomi MiMo (Token Plan)</SelectItem>
                  <SelectItem value="lightning">Lightning AI (Claude Fable)</SelectItem>
                  <SelectItem value="ollama">Ollama (Gemma Local)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Dynamic fields based on provider */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {aiProvider === 'groq' && (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-400">Groq API Key</Label>
                    <div className="relative">
                      <Input
                        type={showKey ? 'text' : 'password'}
                        value={groqApiKey}
                        onChange={e => updateGroqApiKey(e.target.value)}
                        placeholder="gsk_..."
                        className="bg-white/[0.03] border-white/[0.06] font-mono text-xs h-9 rounded-xl pr-10 text-amber-100 placeholder:text-slate-700"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                      >
                        {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-400">Modelo Groq</Label>
                    <Select value={groqModel} onValueChange={updateGroqModel}>
                      <SelectTrigger className="bg-white/[0.03] border-white/[0.06] text-xs h-9 rounded-xl text-amber-100">
                        <SelectValue placeholder="Seleccioná un modelo..." />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-950/95 backdrop-blur-2xl border-white/[0.08] text-slate-200">
                        <SelectItem value="llama-3.3-70b-versatile">llama-3.3-70b-versatile (Recomendado)</SelectItem>
                        <SelectItem value="llama-3.1-8b-instant">llama-3.1-8b-instant (Rápido)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              {aiProvider === 'mimo' && (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-400">Xiaomi MiMo API Key</Label>
                    <div className="relative">
                      <Input
                        type={showKey ? 'text' : 'password'}
                        value={mimoApiKey}
                        onChange={e => updateMimoApiKey(e.target.value)}
                        placeholder="tp-..."
                        className="bg-white/[0.03] border-white/[0.06] font-mono text-xs h-9 rounded-xl pr-10 text-amber-100 placeholder:text-slate-700"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                      >
                        {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-400">Modelo MiMo (Token Plan)</Label>
                    <Select value={mimoModel} onValueChange={updateMimoModel}>
                      <SelectTrigger className="bg-white/[0.03] border-white/[0.06] text-xs h-9 rounded-xl text-amber-100">
                        <SelectValue placeholder="Seleccioná un modelo..." />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-950/95 backdrop-blur-2xl border-white/[0.08] text-slate-200">
                        <SelectItem value="mimo-v2.5-pro">mimo-v2.5-pro (Flagship - Recomendado)</SelectItem>
                        <SelectItem value="mimo-v2.5">mimo-v2.5</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label className="text-xs text-slate-400">Endpoint / Base URL (Token Plan)</Label>
                    <Input
                      value={mimoBaseUrl}
                      onChange={e => updateMimoBaseUrl(e.target.value)}
                      placeholder="https://token-plan-sgp.xiaomimimo.com/v1"
                      className="bg-white/[0.03] border-white/[0.06] font-mono text-xs h-9 rounded-xl text-amber-100"
                    />
                    <p className="text-[10px] text-slate-500">
                      Podés cambiarlo si usás otro clúster de MiMo (por ejemplo: cn para China o ams para Europa).
                    </p>
                  </div>
                </>
              )}

              {aiProvider === 'lightning' && (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-400">Lightning API Key</Label>
                    <div className="relative">
                      <Input
                        type={showKey ? 'text' : 'password'}
                        value={lightningApiKey}
                        onChange={e => updateLightningApiKey(e.target.value)}
                        placeholder="Ingresá tu API Key de Lightning AI"
                        className="bg-white/[0.03] border-white/[0.06] font-mono text-xs h-9 rounded-xl pr-10 text-amber-100 placeholder:text-slate-700"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                      >
                        {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-400">Modelo Lightning</Label>
                    <Input
                      value={lightningModel}
                      onChange={e => updateLightningModel(e.target.value)}
                      placeholder="anthropic/claude-fable-5"
                      className="bg-white/[0.03] border-white/[0.06] text-xs h-9 rounded-xl text-amber-100"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label className="text-xs text-slate-400">Endpoint / Base URL (Lightning AI)</Label>
                    <Input
                      value={lightningBaseUrl}
                      onChange={e => updateLightningBaseUrl(e.target.value)}
                      placeholder="https://lightning.ai/api/v1"
                      className="bg-white/[0.03] border-white/[0.06] font-mono text-xs h-9 rounded-xl text-amber-100"
                    />
                  </div>
                </>
              )}

              {aiProvider === 'ollama' && (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-400">Modelo Ollama</Label>
                    <Input
                      value={ollamaModel}
                      onChange={e => updateOllamaModel(e.target.value)}
                      placeholder="gemma2"
                      className="bg-white/[0.03] border-white/[0.06] text-xs h-9 rounded-xl text-amber-100"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label className="text-xs text-slate-400">Endpoint / Base URL (Ollama)</Label>
                    <Input
                      value={ollamaBaseUrl}
                      onChange={e => updateOllamaBaseUrl(e.target.value)}
                      placeholder="http://localhost:11434/v1"
                      className="bg-white/[0.03] border-white/[0.06] font-mono text-xs h-9 rounded-xl text-amber-100"
                    />
                    <p className="text-[10px] text-slate-500">
                      Dejalo como http://localhost:11434/v1 si lo tenés corriendo en tu propia PC.
                    </p>
                  </div>
                </>
              )}
            </div>

            {activeApiKey && aiProvider !== 'ollama' && (
              <p className="text-[10px] text-emerald-400/80 mt-3 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 animate-pulse" /> API Key guardada de forma segura en tu navegador.
              </p>
            )}
            {aiProvider === 'ollama' && (
              <p className="text-[10px] text-emerald-400/80 mt-3 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 animate-pulse" /> Ollama no requiere clave de API. Conexión local activa.
              </p>
            )}
          </div>
        )}

        <Tabs defaultValue="mantenimiento" className="space-y-6">
          <TabsList className="glass-card rounded-2xl p-1.5 h-auto bg-slate-900/50 border border-white/[0.06]">
            <TabsTrigger value="mantenimiento" className="rounded-xl px-5 py-2.5 text-xs font-semibold data-[state=active]:bg-gradient-to-r data-[state=active]:from-amber-500/20 data-[state=active]:to-orange-500/10 data-[state=active]:text-amber-100 data-[state=active]:shadow-lg data-[state=active]:shadow-amber-500/5 text-slate-400 gap-2 transition-all">
              <Wrench className="w-3.5 h-3.5" />
              Mantenimiento & Stock
            </TabsTrigger>
            <TabsTrigger value="cierre" className="rounded-xl px-5 py-2.5 text-xs font-semibold data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500/20 data-[state=active]:to-green-500/10 data-[state=active]:text-emerald-100 data-[state=active]:shadow-lg data-[state=active]:shadow-emerald-500/5 text-slate-400 gap-2 transition-all">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Órdenes OK para Cierre
            </TabsTrigger>
            <TabsTrigger value="ov" className="rounded-xl px-5 py-2.5 text-xs font-semibold data-[state=active]:bg-gradient-to-r data-[state=active]:from-cyan-500/20 data-[state=active]:to-blue-500/10 data-[state=active]:text-cyan-100 data-[state=active]:shadow-lg data-[state=active]:shadow-cyan-500/5 text-slate-400 gap-2 transition-all">
              <ShoppingCart className="w-3.5 h-3.5" />
              OV vs Materiales
            </TabsTrigger>
          </TabsList>

          <TabsContent value="mantenimiento" className="space-y-8 mt-6">

        {/* Section 1: Upload */}
        <section className="animate-fade-in-up animate-fade-in-up-1">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <SectionNumber n={1} />
              <div>
                <h2 className="text-base font-semibold text-white">Obtener datos origen</h2>
                <p className="text-[11px] text-slate-500 mt-0.5">Importá por Excel o conectate a SAP Business One</p>
              </div>
            </div>
            <div className="flex bg-slate-900/50 p-1 rounded-xl border border-white/[0.06]">
              <button onClick={() => setDataSource('excel')} className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${dataSource === 'excel' ? 'bg-amber-500/20 text-amber-300' : 'text-slate-500 hover:text-slate-300'}`}>Excel</button>
              <button onClick={() => setDataSource('sap')} className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${dataSource === 'sap' ? 'bg-blue-500/20 text-blue-300' : 'text-slate-500 hover:text-slate-300'}`}>SAP B1</button>
            </div>
          </div>
          
          {dataSource === 'excel' ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FileUploader label="Tareas (Excel o CSV)" hint="Columna requerida: DocNum o Nro. Orden" accept=".xlsx,.csv" fileName={tarFileName} filled={!!tarFileName} onFile={handleTarFile} icon={<FileSpreadsheet className="w-6 h-6" />} />
              <FileUploader label="Materiales (Excel o CSV)" hint="Columna requerida: Nro. OM o Nro. Orden" accept=".xlsx,.csv" fileName={matFileName} filled={!!matFileName} onFile={handleMatFile} icon={<Warehouse className="w-6 h-6" />} />
              <FileUploader label="Órdenes (Excel o CSV) — Opcional" hint="Agrega Tipo de orden y Centros de costos por OM" accept=".xlsx,.csv" fileName={ordFileName} filled={!!ordFileName} onFile={handleOrdFile} icon={<ClipboardList className="w-6 h-6" />} />
            </div>
          ) : (
            <div className="glass-card rounded-2xl p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-2 lg:col-span-2">
                <Label className="text-xs text-slate-400">URL Service Layer</Label>
                <Input value={sapUrl} onChange={e => setSapUrl(e.target.value)} placeholder="https://servidor:50000/b1s/v1" className="bg-white/[0.03] border-white/[0.06] font-mono text-xs h-9 rounded-xl" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-slate-400">Base de Datos (CompanyDB)</Label>
                <Input value={sapCompany} onChange={e => setSapCompany(e.target.value)} className="bg-white/[0.03] border-white/[0.06] font-mono text-xs h-9 rounded-xl" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-slate-400">Usuario SAP</Label>
                <Input value={sapUser} onChange={e => setSapUser(e.target.value)} className="bg-white/[0.03] border-white/[0.06] font-mono text-xs h-9 rounded-xl" />
              </div>
              <div className="space-y-2 lg:col-start-3">
                <Label className="text-xs text-slate-400">Contraseña</Label>
                <Input type="password" value={sapPass} onChange={e => setSapPass(e.target.value)} className="bg-white/[0.03] border-white/[0.06] font-mono text-xs h-9 rounded-xl" />
              </div>
              
              <div className="lg:col-span-4 border-t border-white/[0.06] my-2 pt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs text-slate-400">Query ID Tareas</Label>
                  <Input value={queryTar} onChange={e => setQueryTar(e.target.value)} className="bg-white/[0.03] border-white/[0.06] font-mono text-xs h-9 rounded-xl text-emerald-400" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-slate-400">Query ID Materiales</Label>
                  <Input value={queryMat} onChange={e => setQueryMat(e.target.value)} className="bg-white/[0.03] border-white/[0.06] font-mono text-xs h-9 rounded-xl text-emerald-400" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-slate-400">Query ID Órdenes</Label>
                  <Input value={queryOrd} onChange={e => setQueryOrd(e.target.value)} className="bg-white/[0.03] border-white/[0.06] font-mono text-xs h-9 rounded-xl text-emerald-400" />
                </div>
              </div>
              
              <div className="lg:col-span-4 mt-2 flex justify-end">
                <Button onClick={handleSapSync} disabled={sapLoading || !sapUrl || !sapCompany || !sapUser || !sapPass} className="btn-shimmer text-black font-semibold text-xs gap-2 h-9 rounded-xl px-6 bg-blue-500 hover:bg-blue-400">
                  {sapLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                  Sincronizar SAP B1
                </Button>
              </div>
            </div>
          )}
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
                      {['Nro. Orden', 'Tipo OM', 'C.Costos', 'Contab.', 'Fecha Orden', 'Estado Doc', 'Equipo', 'Tarea', 'Tipo', 'Detalle'].map((h, i) => {
                        let visibilityClass = "";
                        if (h === 'Tipo OM') visibilityClass = "hidden lg:table-cell";
                        else if (h === 'Contab.') visibilityClass = "hidden xl:table-cell";
                        else if (h === 'Fecha Orden') visibilityClass = "hidden xl:table-cell";
                        else if (h === 'Estado Doc') visibilityClass = "hidden xl:table-cell";
                        else if (h === 'Equipo') visibilityClass = "hidden lg:table-cell";
                        else if (h === 'Detalle') visibilityClass = "hidden xl:table-cell";
                        return (
                          <TableHead key={h} className={`bg-white/[0.02] text-slate-400 text-[10px] uppercase tracking-widest font-semibold ${visibilityClass}`}>{h}</TableHead>
                        );
                      })}
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
                        
                        {/* Contabilizada */}
                        <TableCell className="text-xs hidden xl:table-cell">
                          {r['Contabilizada'] ? (
                            <Badge variant="outline" className={`text-[10px] font-mono ${String(r['Contabilizada']).toUpperCase() === 'SI' ? 'border-emerald-500/25 text-emerald-300 bg-emerald-500/[0.07]' : 'border-slate-500/25 text-slate-300 bg-slate-500/[0.07]'}`}>{esc(r['Contabilizada'])}</Badge>
                          ) : <span className="text-slate-600 text-xs">—</span>}
                        </TableCell>

                        {/* Fecha de la orden */}
                        <TableCell className="font-mono text-xs text-slate-300 hidden xl:table-cell">
                          {esc(r['Fecha de la orden']) || <span className="text-slate-600">—</span>}
                        </TableCell>

                        {/* Status de documento */}
                        <TableCell className="text-xs hidden xl:table-cell">
                          {r['Status de documento'] ? (
                            <Badge variant="outline" className="text-[10px] font-mono border-blue-500/25 text-blue-300 bg-blue-500/[0.07]">{esc(r['Status de documento'])}</Badge>
                          ) : <span className="text-slate-600 text-xs">—</span>}
                        </TableCell>

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
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end mt-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-400">Orden a auditar</Label>
                    <Select value={selectedOrder} onValueChange={setSelectedOrder}>
                      <SelectTrigger className="bg-white/[0.03] border-white/[0.06] font-mono text-sm h-10 rounded-xl"><SelectValue placeholder="Seleccioná una orden..." /></SelectTrigger>
                      <SelectContent className="bg-slate-800/95 backdrop-blur-xl border-white/[0.08] max-h-60">
                        {uniqueOrders.map(o => (<SelectItem key={o} value={o} className="font-mono text-xs">OM {o}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={handleAnalyzeIA} disabled={!selectedOrder || aiAnalyzeLoading} className="btn-shimmer text-black font-semibold gap-2 h-10 rounded-xl px-6">
                      {aiAnalyzeLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                      Analizar
                    </Button>
                    <Button onClick={handleCoherenceCheck} disabled={!selectedOrder || coherenceLoading} variant="outline"
                      className="gap-2 h-10 rounded-xl px-6 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200">
                      {coherenceLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                      Control de Coherencia IA
                    </Button>
                  </div>
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

                {/* Indicador visual del "Control Avanzado" de coherencia IA (JSON estructurado) para la OM seleccionada */}
                {coherenceError && (
                  <div className="rounded-xl p-4 text-sm bg-orange-500/[0.07] border border-orange-500/20 text-orange-300">
                    {coherenceError}
                  </div>
                )}
                {selectedOrder && coherenceResults[selectedOrder] && (() => {
                  const cr = coherenceResults[selectedOrder];
                  return (
                    <div className={`rounded-xl p-5 text-sm leading-relaxed backdrop-blur-sm border ${
                      cr.coherente
                        ? 'bg-emerald-500/[0.07] border-emerald-500/25 text-emerald-200'
                        : 'bg-red-500/[0.07] border-red-500/25 text-red-200'
                    }`}>
                      <div className="flex items-center gap-2 mb-2">
                        {cr.coherente
                          ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          : <AlertTriangle className="w-4 h-4 text-red-400" />}
                        <strong className={cr.coherente ? 'text-emerald-300' : 'text-red-300'}>
                          OM {selectedOrder} · {cr.coherente ? 'Coherente' : 'Incoherente'}
                        </strong>
                        <Badge variant="outline" className="ml-auto text-[10px] font-mono border-white/10 text-slate-400">
                          <Sparkles className="w-3 h-3 mr-1" /> IA
                        </Badge>
                      </div>
                      {!cr.coherente && cr.discrepancia_detectada && (
                        <p className="mt-1"><strong className="text-slate-300">Discrepancia detectada:</strong> {cr.discrepancia_detectada}</p>
                      )}
                      {cr.sugerencia_control && (
                        <p className="mt-1"><strong className="text-slate-300">Sugerencia de control:</strong> {cr.sugerencia_control}</p>
                      )}
                    </div>
                  );
                })()}
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
                    <Button size="sm" onClick={handleAnalyzeDict} disabled={unrecognizedTasks.length === 0 || aiDictLoading} className="btn-shimmer text-black font-semibold text-xs gap-1.5 rounded-xl">
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

          </TabsContent>

          <TabsContent value="cierre" className="space-y-6 mt-6 animate-fade-in-up">
            {/* Report Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="glass-card border border-white/[0.06] shadow-lg rounded-2xl overflow-hidden relative">
                <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500" />
                <CardHeader className="pb-2">
                  <CardTitle className="text-slate-400 text-xs font-semibold tracking-wider uppercase">Cierres OK Totales</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-white tracking-tight font-mono">
                      {closingReport.length}
                    </span>
                    <span className="text-xs text-slate-500 font-medium">órdenes</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-2">Órdenes sin discrepancias listas para archivar</p>
                </CardContent>
              </Card>

              <Card className="glass-card border border-white/[0.06] shadow-lg rounded-2xl overflow-hidden relative">
                <div className="absolute top-0 left-0 w-1 h-full bg-blue-500" />
                <CardHeader className="pb-2">
                  <CardTitle className="text-slate-400 text-xs font-semibold tracking-wider uppercase">Cierres con Materiales</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-white tracking-tight font-mono">
                      {closingReport.filter(r => r.tipo === 'Con Materiales').length}
                    </span>
                    <span className="text-xs text-slate-500 font-medium">órdenes</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-2">Con recambios y salidas de repuestos en SAP</p>
                </CardContent>
              </Card>

              <Card className="glass-card border border-white/[0.06] shadow-lg rounded-2xl overflow-hidden relative">
                <div className="absolute top-0 left-0 w-1 h-full bg-slate-500" />
                <CardHeader className="pb-2">
                  <CardTitle className="text-slate-400 text-xs font-semibold tracking-wider uppercase">Cierres de Solo Servicio</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-white tracking-tight font-mono">
                      {closingReport.filter(r => r.tipo === 'Sin Materiales (Solo Servicio/Control)').length}
                    </span>
                    <span className="text-xs text-slate-500 font-medium">órdenes</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-2">Solo controles, ajustes y mano de obra finalizados</p>
                </CardContent>
              </Card>
            </div>

            {/* Filters */}
            <div className="glass-card rounded-2xl p-5 border border-white/[0.06] flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto items-center">
                <div className="relative w-full md:w-80">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
                  <Input
                    placeholder="Buscar por OM o Equipo..."
                    value={closingSearch}
                    onChange={e => setClosingSearch(e.target.value)}
                    className="bg-white/[0.03] border-white/[0.06] pl-9 text-xs h-9 rounded-xl text-amber-100"
                  />
                </div>
                <Select value={closingTypeFilter} onValueChange={(val: any) => setClosingTypeFilter(val)}>
                  <SelectTrigger className="bg-white/[0.03] border-white/[0.06] text-xs h-9 rounded-xl text-amber-100 w-full md:w-60">
                    <SelectValue placeholder="Filtrar por tipo..." />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-950/95 backdrop-blur-2xl border-white/[0.08] text-slate-200">
                    <SelectItem value="ALL">Todos los cierres</SelectItem>
                    <SelectItem value="WITH_MAT">Con Materiales</SelectItem>
                    <SelectItem value="WITHOUT_MAT">Sin Materiales (Solo Servicio/Control)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {closingReport.length > 0 && (
                <Button
                  onClick={handleExportClosingExcel}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs gap-1.5 rounded-xl h-9 w-full md:w-auto shadow-lg shadow-emerald-600/10 transition-all shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  Exportar Cierres OK
                </Button>
              )}
            </div>

            {/* Table */}
            <div className="glass-card rounded-2xl border border-white/[0.06] overflow-hidden shadow-2xl">
              <div className="p-5 border-b border-white/[0.06] flex items-center justify-between bg-white/[0.01]">
                <div>
                  <h3 className="text-sm font-semibold text-white">Órdenes OK para Cierre</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">Listado detallado de órdenes listas para cierre administrativo</p>
                </div>
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 px-3 py-1 font-mono text-xs rounded-xl">
                  {filteredClosingReport.length} filtradas
                </Badge>
              </div>

              {filteredClosingReport.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-xs text-slate-500 italic">No se encontraron órdenes OK para cierre con los filtros aplicados.</p>
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <Table>
                    <TableHeader className="bg-white/[0.01] border-b border-white/[0.06]">
                      <TableRow className="border-b border-white/[0.06] hover:bg-transparent">
                        <TableHead className="text-xs font-semibold text-slate-400 h-10 w-24 text-center">Nro. OM</TableHead>
                        <TableHead className="text-xs font-semibold text-slate-400 h-10 w-44">Equipo</TableHead>
                        <TableHead className="text-xs font-semibold text-slate-400 h-10 w-48 text-center">Tipo de Cierre</TableHead>
                        <TableHead className="text-xs font-semibold text-slate-400 h-10">Tareas Realizadas (Terminadas)</TableHead>
                        <TableHead className="text-xs font-semibold text-slate-400 h-10">Materiales Consumidos</TableHead>
                        <TableHead className="text-xs font-semibold text-slate-400 h-10 w-24 text-center">Fecha OM</TableHead>
                        <TableHead className="text-xs font-semibold text-slate-400 h-10 w-24 text-center">Status Doc</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredClosingReport.map((r) => (
                        <TableRow key={r.order} className="border-b border-white/[0.04] hover:bg-white/[0.01] transition-colors">
                          <TableCell className="text-xs font-bold text-white font-mono text-center">{r.order}</TableCell>
                          <TableCell className="text-xs">
                            <div className="font-semibold text-slate-200">{r.equipo}</div>
                            <div className="text-[10px] text-slate-500 truncate max-w-[160px]">{r.nombreEquipo}</div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              className={`text-[10px] rounded-lg px-2 py-0.5 border ${
                                r.tipo === 'Con Materiales'
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                  : 'bg-slate-500/10 text-slate-400 border-white/[0.06]'
                              }`}
                            >
                              {r.tipo}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            <div className="space-y-1">
                              {r.tasks.map((t, i) => (
                                <div key={i} className="flex items-start gap-1.5 leading-tight">
                                  <span className="text-emerald-500 text-[10px] mt-0.5">✓</span>
                                  <span className="text-slate-300 font-mono text-[11px]">{t.tarea}</span>
                                </div>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">
                            {r.materials.length === 0 ? (
                              <span className="text-slate-500 italic text-[11px]">Sin materiales (solo mano de obra)</span>
                            ) : (
                              <div className="space-y-1">
                                {r.materials.map((m, i) => (
                                  <div key={i} className="flex items-center gap-1.5 leading-none">
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                                    <span className="text-slate-300 font-mono text-[11px]">
                                      {m.desc} <span className="text-blue-400 font-semibold">(Cant: {m.salidas})</span>
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-slate-400 font-mono text-center">{r.fechaOrden || '-'}</TableCell>
                          <TableCell className="text-xs text-slate-400 font-mono text-center">{r.statusDoc || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </div>
          </TabsContent>

          <TabsContent value="ov" className="mt-6">
            <OVTab apiKey={activeApiKey} model={activeModel} provider={aiProvider} baseUrl={activeBaseUrl} onShowSettings={() => setShowSettings(true)} />
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