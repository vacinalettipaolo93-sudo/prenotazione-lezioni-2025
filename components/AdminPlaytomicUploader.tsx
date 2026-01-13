/**
 * AdminPlaytomicUploader.tsx
 *
 * Componente React (TypeScript) autoconclusivo per aggiungere, nella UI amministratore
 * -> una tab che permette di caricare un file CSV o JSON esportato da Playtomic
 * -> visualizzare/validare le prenotazioni lette
 * -> inviare i blocchi al backend (o usare una callback fornita dal componente)
 *
 * Come usare:
 * 1) Copia questo file in components/AdminPlaytomicUploader.tsx
 * 2) Importalo nella pagina/view del calendario admin e inseriscilo nella tab desiderata:
 *    import AdminPlaytomicUploader from './AdminPlaytomicUploader';
 *
 * Props:
 * - onCreateBlocks?: (blocks: PlaytomicBlock[]) => Promise<void> | void
 *      callback che riceve i blocchi identificati; se non fornita il componente farà POST a createEndpoint
 * - locations?: string[]  lista di nomi sedi per la select (opz.)
 * - sports?: string[]     lista di nomi sport per la select (opz.)
 * - createEndpoint?: string endpoint REST di default per POST (default: /api/admin/calendar/block-slots)
 *
 * Nota: il componente NON scrive direttamente su Firebase: espone i blocchi via callback o POST.
 */

import React, { useState, useRef, ChangeEvent } from 'react';

export type PlaytomicBlock = {
  start: string; // ISO datetime
  end: string;   // ISO datetime
  sport: string;
  location: string;
  source?: string; // filename o riga di origine
  meta?: Record<string, any>;
};

type Props = {
  onCreateBlocks?: (blocks: PlaytomicBlock[]) => Promise<void> | void;
  locations?: string[]; // opzioni per la select sede
  sports?: string[];    // opzioni per la select sport
  createEndpoint?: string;
};

const DEFAULT_ENDPOINT = '/api/admin/calendar/block-slots';

function simpleCsvParse(text: string): Record<string, string>[] {
  const lines: string[] = [];
  let curr = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      curr += ch;
    } else if (ch === '\n' && !inQuotes) {
      lines.push(curr.replace(/\r$/, ''));
      curr = '';
    } else {
      curr += ch;
    }
  }
  if (curr.length) lines.push(curr.replace(/\r$/, ''));
  if (lines.length === 0) return [];

  const splitLine = (line: string) => {
    const res: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' ) {
        q = !q;
      } else if (c === ',' && !q) {
        res.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    res.push(cur);
    return res.map(s => s.trim().replace(/^"|"$/g, ''));
  };

  const headers = splitLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = splitLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j] ?? `col${j}`] = cells[j] ?? '';
    }
    rows.push(row);
  }
  return rows;
}

function guessIsoFromValue(v: string): string | null {
  if (!v) return null;
  const t = v.trim();
  const isoLike = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/;
  if (isoLike.test(t)) {
    try {
      const d = new Date(t);
      if (!isNaN(d.getTime())) return d.toISOString();
    } catch {}
  }
  const spaceDateTime = /^(\d{4}[-/]\d{1,2}[-/]\d{1,2})[ T](\d{1,2}:\d{2})/;
  const dmySpace = /^(\d{1,2}\/\d{1,2}\/\d{4})[ T](\d{1,2}:\d{2})/;
  let m = t.match(spaceDateTime);
  if (m) {
    const s = `${m[1]}T${m[2]}:00`;
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  m = t.match(dmySpace);
  if (m) {
    const [day, month, year] = m[1].split('/');
    const s = `${year}-${String(Number(month)).padStart(2, '0')}-${String(Number(day)).padStart(2,'0')}T${m[2]}:00`;
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date(t);
  if (!isNaN(d.getTime())) return d.toISOString();
  return null;
}

function mapRowToBlock(row: Record<string, string>, defaults: { sport?: string; location?: string }, filename?: string): PlaytomicBlock | null {
  const keys = Object.keys(row).reduce<Record<string,string>>((acc,k)=>{acc[k.toLowerCase().trim()]=row[k]; return acc;},{});
  const possibleStart = keys['start'] ?? keys['start_time'] ?? keys['from'] ?? keys['begin'] ?? keys['booking_start'] ?? keys['start_datetime'] ?? keys['start date'] ?? keys['datetime'];
  const possibleEnd = keys['end'] ?? keys['end_time'] ?? keys['to'] ?? keys['finish'] ?? keys['booking_end'] ?? keys['end_datetime'] ?? keys['end date'];
  const possibleSport = keys['sport'] ?? keys['activity'] ?? keys['activity_type'];
  const possibleLocation = keys['location'] ?? keys['venue'] ?? keys['centre'] ?? keys['sede'] ?? keys['club'];
  let startIso = guessIsoFromValue(possibleStart ?? '');
  let endIso = guessIsoFromValue(possibleEnd ?? '');
  if (!endIso) {
    const duration = keys['duration'] ?? keys['slot_length'] ?? keys['length_minutes'];
    if (duration && startIso) {
      const d = new Date(startIso);
      const mins = Number(duration) || parseInt(duration as string, 10) || 60;
      d.setMinutes(d.getMinutes() + mins);
      endIso = d.toISOString();
    }
  }
  if (startIso && !endIso) {
    const d = new Date(startIso);
    d.setHours(d.getHours() + 1);
    endIso = d.toISOString();
  }
  if (!startIso || !endIso) return null;
  const sport = (possibleSport && possibleSport.trim()) || defaults.sport || '';
  const location = (possibleLocation && possibleLocation.trim()) || defaults.location || '';
  const block: PlaytomicBlock = {
    start: startIso,
    end: endIso,
    sport,
    location,
    source: filename,
    meta: row
  };
  return block;
}

export default function AdminPlaytomicUploader(props: Props) {
  const { onCreateBlocks, locations = [], sports = [], createEndpoint = DEFAULT_ENDPOINT } = props;
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawContent, setRawContent] = useState<string | null>(null);
  const [parsedRows, setParsedRows] = useState<Record<string,string>[]>([]);
  const [blocks, setBlocks] = useState<PlaytomicBlock[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [overrideSport, setOverrideSport] = useState<string>('');
  const [overrideLocation, setOverrideLocation] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setRawContent(text);
      parseContent(text, f.name);
    };
    reader.readAsText(f, 'utf-8');
  };

  const parseContent = (text: string, filename?: string) => {
    setErrors([]);
    setParsedRows([]);
    setBlocks([]);
    const trimmed = text.trim();
    try {
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        const j = JSON.parse(trimmed);
        let rows: Record<string,string>[] = [];
        if (Array.isArray(j)) {
          rows = j.map(item => {
            if (typeof item !== 'object' || item === null) return {};
            const out: Record<string,string> = {};
            for (const k of Object.keys(item)) {
              const val = (item as any)[k];
              out[String(k)] = val == null ? '' : String(val);
            }
            return out;
          });
        } else if (typeof j === 'object') {
          const arr = (j as any).bookings ?? (j as any).items ?? (j as any).results ?? [];
          if (Array.isArray(arr)) {
            rows = arr.map((item:any) => {
              const out: Record<string,string> = {};
              for (const k of Object.keys(item || {})) {
                const val = item[k];
                out[String(k)] = val == null ? '' : String(val);
              }
              return out;
            });
          } else {
            throw new Error('JSON non riconosciuto: si aspetta un array o un oggetto con chiave bookings/items/results');
          }
        } else {
          throw new Error('JSON non riconosciuto');
        }
        setParsedRows(rows);
        const mapped = rows.map(r => mapRowToBlock(r, { sport: overrideSport, location: overrideLocation }, filename)).filter(Boolean) as PlaytomicBlock[];
        setBlocks(mapped);
      } else {
        const rows = simpleCsvParse(text);
        setParsedRows(rows);
        const mapped = rows.map(r => mapRowToBlock(r, { sport: overrideSport, location: overrideLocation }, filename)).filter(Boolean) as PlaytomicBlock[];
        setBlocks(mapped);
      }
    } catch (err: any) {
      setErrors([String(err.message || err)]);
    }
  };

  const handleApply = async () => {
    setErrors([]);
    if (!blocks || blocks.length === 0) {
      setErrors(['Nessun blocco valido da inviare. Controlla il file o i campi override.']);
      return;
    }
    setApplying(true);
    try {
      if (onCreateBlocks) {
        await Promise.resolve(onCreateBlocks(blocks));
        alert(`Inviati ${blocks.length} blocchi tramite callback.`);
      } else {
        const res = await fetch(createEndpoint, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ blocks })
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`Server risponde con ${res.status}: ${txt}`);
        }
        alert(`Inviati ${blocks.length} blocchi al server.`);
      }
    } catch (err: any) {
      setErrors([String(err.message || err)]);
    } finally {
      setApplying(false);
    }
  };

  const handleReparse = () => {
    if (rawContent) parseContent(rawContent, fileName ?? undefined);
  };

  const clear = () => {
    setFileName(null);
    setRawContent(null);
    setParsedRows([]);
    setBlocks([]);
    setErrors([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div style={{ padding: 12, maxWidth: 900 }}>
      <h3>Importa prenotazioni Playtomic (CSV / JSON)</h3>
      <p>
        Carica il file esportato da Playtomic (CSV o JSON). Il componente prova a interpretare colonne
        comuni come start, end, start_time, end_time, duration, sport, location. Puoi sovrascrivere sport e sede usando
        le select/field sottostanti. Tutto il resto dell'app rimane invariato.
      </p>

      <div style={{ marginBottom: 10 }}>
        <input ref={fileInputRef} type="file" accept=".csv,.json,application/json,text/csv" onChange={handleFile} />
        {fileName && <div style={{ marginTop: 6 }}>File: <strong>{fileName}</strong></div>}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <div>
          <label>Override sport (opzionale)</label>
          <div>
            {sports.length > 0 ? (
              <select value={overrideSport} onChange={e => { setOverrideSport(e.target.value); setTimeout(handleReparse,0); }}>
                <option value=''>-- usa valore nel file --</option>
                {sports.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <input placeholder="es. tennis" value={overrideSport} onChange={e => { setOverrideSport(e.target.value); setTimeout(handleReparse,0); }} />
            )}
          </div>
        </div>

        <div>
          <label>Override sede (opzionale)</label>
          <div>
            {locations.length > 0 ? (
              <select value={overrideLocation} onChange={e => { setOverrideLocation(e.target.value); setTimeout(handleReparse,0); }}>
                <option value=''>-- usa valore nel file --</option>
                {locations.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            ) : (
              <input placeholder="es. salo" value={overrideLocation} onChange={e => { setOverrideLocation(e.target.value); setTimeout(handleReparse,0); }} />
            )}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <button onClick={handleReparse} disabled={!rawContent}>Rileggi file</button>{' '}
        <button onClick={clear}>Pulisci</button>{' '}
        <button onClick={handleApply} disabled={applying || !blocks || blocks.length === 0}>
          {applying ? 'Invio...' : `Crea ${blocks.length > 0 ? blocks.length : ''} blocchi`}
        </button>
      </div>

      {errors.length > 0 && (
        <div style={{ color: 'darkred', marginBottom: 10 }}>
          {errors.map((er,i) => <div key={i}>• {er}</div>)}
        </div>
      )}

      <div style={{ marginBottom: 10 }}>
        <h4>Anteprima blocchi ({blocks.length})</h4>
        {blocks.length === 0 && <div>Nessun blocco valido rilevato.</div>}
        {blocks.length > 0 && (
          <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid #ddd', padding: 8, borderRadius: 4 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 6 }}>start (ISO)</th>
                  <th style={{ textAlign: 'left', padding: 6 }}>end (ISO)</th>
                  <th style={{ textAlign: 'left', padding: 6 }}>sport</th>
                  <th style={{ textAlign: 'left', padding: 6 }}>sede</th>
                </tr>
              </thead>
              <tbody>
                {blocks.slice(0,200).map((b, idx) => (
                  <tr key={idx}>
                    <td style={{ padding: 6, borderTop: '1px solid #eee' }}>{b.start}</td>
                    <td style={{ padding: 6, borderTop: '1px solid #eee' }}>{b.end}</td>
                    <td style={{ padding: 6, borderTop: '1px solid #eee' }}>{b.sport || '-'}</td>
                    <td style={{ padding: 6, borderTop: '1px solid #eee' }}>{b.location || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {blocks.length > 200 && <div style={{ marginTop: 8 }}>Mostrate solo le prime 200 righe.</div>}
          </div>
        )}
      </div>

      <div style={{ marginTop: 8, fontSize: 13, color: '#555' }}>
        Note:
        <ul>
          <li>Il componente prova a indovinare le colonne più comuni. Se il file usa nomi diversi, il campo "Override" permette di forzare sport/sede.</li>
          <li>Il componente non cambia altri file dell'app: è un nuovo componente che tu decidi dove inserire (tab del calendario admin).</li>
          <li>Per integrare la creazione effettiva dei blocchi, puoi fornire la prop onCreateBlocks oppure lasciare che il componente faccia POST a <code>{createEndpoint}</code>.</li>
        </ul>
      </div>
    </div>
  );
}
