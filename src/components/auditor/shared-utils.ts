import Papa from 'papaparse';
import ExcelJS from 'exceljs';

export async function parseTabularFile(file: File): Promise<Record<string, unknown>[]> {
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

export function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function thinBorder() {
  const side = { style: 'thin' as const, color: { argb: 'FFD9D9D9' } };
  return { top: side, bottom: side, left: side, right: side };
}