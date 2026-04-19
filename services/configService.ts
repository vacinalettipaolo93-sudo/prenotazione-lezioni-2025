import {
  AppConfig,
  Sport,
  SportLocation,
  WeeklySchedule,
  DailySchedule
} from '../types';

import { db } from './firebase';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';

const CONFIG_DOC_ID = 'global_settings';
const CONFIG_COLLECTION = 'settings';

// Backup collection (nuova)
const CONFIG_BACKUP_COLLECTION = 'settings_backups';
const BACKUP_SCHEMA_VERSION = 1;

const DEFAULT_SCHEDULE: WeeklySchedule = {
  monday: { isOpen: true, start: '09:00', end: '22:00', allowedLessonTypeIds: [] },
  tuesday: { isOpen: true, start: '09:00', end: '22:00', allowedLessonTypeIds: [] },
  wednesday: { isOpen: true, start: '09:00', end: '22:00', allowedLessonTypeIds: [] },
  thursday: { isOpen: true, start: '09:00', end: '22:00', allowedLessonTypeIds: [] },
  friday: { isOpen: true, start: '09:00', end: '22:00', allowedLessonTypeIds: [] },
  saturday: { isOpen: true, start: '09:00', end: '18:00', allowedLessonTypeIds: [] },
  sunday: { isOpen: false, start: '09:00', end: '13:00', allowedLessonTypeIds: [] },
};

const DEFAULT_CONFIG: AppConfig = {
  homeTitle: 'Domina il Campo',
  homeSubtitle: 'Prenota la tua lezione e migliora il tuo gioco con piani di allenamento IA personalizzati.',
  minBookingNoticeMinutes: 60,
  importBusyCalendars: ['primary'],
  sports: [
    {
      id: '1',
      name: 'Tennis',
      emoji: '🎾',
      description: 'Migliora il tuo dritto e rovescio.',
      locations: [
        {
          id: 'loc_t1',
          name: 'Club Centrale',
          address: 'Via Roma 10',
          schedule: JSON.parse(JSON.stringify(DEFAULT_SCHEDULE)),
          scheduleExceptions: {},
          slotInterval: 60,
          googleCalendarId: ''
        }
      ],
      lessonTypes: [
        { id: 'lt_1', name: 'Lezione Singola' },
        { id: 'lt_2', name: 'Lezione Doppia' }
      ],
      durations: [60, 90]
    },
    {
      id: '2',
      name: 'Padel',
      emoji: '🏸',
      description: 'Vetri, griglie e bandeja.',
      locations: [
        {
          id: 'loc_p1',
          name: 'Circolo Nord',
          address: 'Via Milano 42',
          schedule: JSON.parse(JSON.stringify(DEFAULT_SCHEDULE)),
          scheduleExceptions: {},
          slotInterval: 60,
          googleCalendarId: ''
        }
      ],
      lessonTypes: [
        { id: 'lt_3', name: 'Partita con Maestro' },
        { id: 'lt_4', name: 'Lezione Gruppo' }
      ],
      durations: [90]
    }
  ]
};

// -------------------------
// Helpers (sicurezza dati)
// -------------------------

const deepClone = <T,>(obj: T): T => JSON.parse(JSON.stringify(obj));

const normalizeConfig = (data: any): AppConfig => {
  const merged: AppConfig = {
    ...deepClone(DEFAULT_CONFIG),
    ...(data || {}),
  } as AppConfig;

  if (!Array.isArray(merged.sports)) merged.sports = [];

  merged.sports = merged.sports.map((s: any) => {
    const sport: any = { ...s };

    if (!Array.isArray(sport.locations)) sport.locations = [];
    if (!Array.isArray(sport.lessonTypes)) sport.lessonTypes = [];
    if (!Array.isArray(sport.durations)) sport.durations = [60];

    sport.locations = sport.locations.map((l: any) => {
      const loc: any = { ...l };
      if (!loc.schedule) loc.schedule = deepClone(DEFAULT_SCHEDULE);
      if (!loc.scheduleExceptions) loc.scheduleExceptions = {};
      if (typeof loc.slotInterval !== 'number') loc.slotInterval = 60;
      if (typeof loc.googleCalendarId !== 'string') loc.googleCalendarId = '';
      return loc;
    });

    return sport as Sport;
  });

  return merged;
};

const validateBeforeSave = (config: AppConfig) => {
  if (!config) throw new Error('Config mancante');

  if (!Array.isArray(config.sports)) {
    throw new Error('Config non valida: sports non è un array');
  }

  // Non vuoi MAI sports vuoto
  if (config.sports.length === 0) {
    throw new Error('Bloccato salvataggio: sports è vuoto (non consentito).');
  }
};

// -------------------------
// Cache + Listener
// -------------------------

let currentConfig: AppConfig = deepClone(DEFAULT_CONFIG);
let listeners: ((config: AppConfig) => void)[] = [];

let hasLoadedFromFirestore = false;

export const initConfigListener = (callback?: (config: AppConfig) => void) => {
  if (callback) listeners.push(callback);

  const ref = doc(db, CONFIG_COLLECTION, CONFIG_DOC_ID);

  const unsubscribe = onSnapshot(
    ref,
    (docSnap) => {
      if (docSnap.exists()) {
        currentConfig = normalizeConfig(docSnap.data());
        // Consideriamo “loaded” solo se la config risultante è valida (sports non vuoto)
        hasLoadedFromFirestore = Array.isArray(currentConfig.sports) && currentConfig.sports.length > 0;
      } else {
        console.warn(
          `[Firebase] Documento config mancante: ${CONFIG_COLLECTION}/${CONFIG_DOC_ID}. ` +
          `Non inizializzo automaticamente DEFAULT_CONFIG per evitare reset.`
        );
        currentConfig = deepClone(DEFAULT_CONFIG);
        hasLoadedFromFirestore = false;
      }

      listeners.forEach((l) => l(currentConfig));
    },
    (error) => {
      console.error('Errore connessione Firebase Config:', error);
    }
  );

  return unsubscribe;
};

export const getAppConfig = (): AppConfig => currentConfig;

// -------------------------
// Backup automatico
// -------------------------

/**
 * Scrive una copia della config in una collezione di backup.
 * DocId: timestamp + random, così eviti collisioni.
 */
const backupConfig = async (config: AppConfig, reason: string) => {
  try {
    const ts = new Date();
    const id =
      ts.toISOString().replace(/[:.]/g, '-') +
      '_' +
      Math.random().toString(16).slice(2);

    const payload = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      reason,
      savedAt: ts.toISOString(),
      config: JSON.parse(JSON.stringify(config)),
    };

    await setDoc(doc(db, CONFIG_BACKUP_COLLECTION, id), payload, { merge: false });
  } catch (e) {
    // Non blocchiamo il salvataggio principale se il backup fallisce,
    // ma lo logghiamo (può essere colpa delle regole).
    console.warn('Backup config fallito:', e);
  }
};

// -------------------------
// Salvataggio (SAFE)
// -------------------------

export const saveAppConfig = async (config: AppConfig) => {
  try {
    if (!hasLoadedFromFirestore) {
      throw new Error(
        'Config non ancora caricata da Firestore: salvataggio bloccato per sicurezza.'
      );
    }

    const normalized = normalizeConfig(config);
    validateBeforeSave(normalized);

    // 1) Backup prima di scrivere (così se qualcosa va storto puoi ripristinare)
    await backupConfig(normalized, 'auto-backup-before-save');

    // 2) Salvataggio sicuro (merge)
    const cleanConfig = JSON.parse(JSON.stringify(normalized));
    await setDoc(
      doc(db, CONFIG_COLLECTION, CONFIG_DOC_ID),
      cleanConfig,
      { merge: true }
    );
  } catch (e) {
    console.error('Errore salvataggio config:', e);
    alert('Errore nel salvataggio online. Verifica la connessione.');
    throw e;
  }
};

// Reset volontario (solo admin)
export const forceResetToDefaultConfig = async () => {
  const clean = JSON.parse(JSON.stringify(deepClone(DEFAULT_CONFIG)));

  // Backup anche del reset (utile!)
  await backupConfig(clean as AppConfig, 'manual-reset-to-default');

  await setDoc(doc(db, CONFIG_COLLECTION, CONFIG_DOC_ID), clean, { merge: false });
};

// -------------------------
// UPDATE FUNCTIONS
// -------------------------

export const updateHomeConfig = (title: string, subtitle: string) => {
  const config = getAppConfig();
  config.homeTitle = title;
  config.homeSubtitle = subtitle;
  saveAppConfig(config);
};

export const updateMinBookingNotice = (minutes: number) => {
  const config = getAppConfig();
  config.minBookingNoticeMinutes = minutes;
  saveAppConfig(config);
};

export const updateImportBusyCalendars = (calendarIds: string[]) => {
  const config = getAppConfig();
  config.importBusyCalendars = calendarIds;
  saveAppConfig(config);
};

// --- SPORT MANAGEMENT ---

export const addSport = (name: string) => {
  const config = getAppConfig();
  config.sports.push({
    id: Date.now().toString(),
    name,
    emoji: '🎾',
    description: 'Nuova attività',
    locations: [],
    lessonTypes: [{ id: 'def_1', name: 'Lezione Standard' }],
    durations: [60]
  });
  saveAppConfig(config);
};

export const updateSport = (sportId: string, updates: Partial<Sport>) => {
  const config = getAppConfig();
  const index = config.sports.findIndex((s) => s.id === sportId);
  if (index !== -1) {
    config.sports[index] = { ...config.sports[index], ...updates };
    saveAppConfig(config);
  }
};

export const removeSport = (sportId: string) => {
  const config = getAppConfig();
  config.sports = config.sports.filter((s) => s.id !== sportId);
  // Se togli l’ultimo sport, validateBeforeSave bloccherà il salvataggio: voluto.
  saveAppConfig(config);
};

// --- NESTED CONFIG MANAGEMENT ---

export const addSportLocation = (sportId: string, name: string, address: string) => {
  const config = getAppConfig();
  const sport = config.sports.find((s) => s.id === sportId);
  if (sport) {
    sport.locations.push({
      id: Date.now().toString(),
      name,
      address,
      schedule: deepClone(DEFAULT_SCHEDULE),
      scheduleExceptions: {},
      slotInterval: 60,
      googleCalendarId: ''
    });
    saveAppConfig(config);
  }
};

export const updateSportLocation = (sportId: string, locId: string, updates: Partial<SportLocation>) => {
  const config = getAppConfig();
  const sport = config.sports.find((s) => s.id === sportId);
  if (sport) {
    const locIndex = sport.locations.findIndex((l) => l.id === locId);
    if (locIndex !== -1) {
      sport.locations[locIndex] = { ...sport.locations[locIndex], ...updates };
      saveAppConfig(config);
    }
  }
};

export const updateLocationException = (
  sportId: string,
  locId: string,
  date: string,
  schedule: DailySchedule | null
) => {
  const config = getAppConfig();
  const sport = config.sports.find((s) => s.id === sportId);
  if (sport) {
    const locIndex = sport.locations.findIndex((l) => l.id === locId);
    if (locIndex !== -1) {
      const loc = sport.locations[locIndex] as any;
      if (!loc.scheduleExceptions) loc.scheduleExceptions = {};

      if (schedule === null) delete loc.scheduleExceptions[date];
      else loc.scheduleExceptions[date] = schedule;

      saveAppConfig(config);
    }
  }
};

export const updateMultipleLocationsExceptions = (
  sportId: string,
  locIds: string[],
  date: string,
  schedule: DailySchedule | null
) => {
  const config = getAppConfig();
  const sport = config.sports.find((s) => s.id === sportId);
  if (sport) {
    locIds.forEach((id) => {
      const loc = sport.locations.find((l) => l.id === id) as any;
      if (loc) {
        if (!loc.scheduleExceptions) loc.scheduleExceptions = {};
        if (schedule === null) delete loc.scheduleExceptions[date];
        else loc.scheduleExceptions[date] = { ...schedule };
      }
    });
    saveAppConfig(config);
  }
};

export const removeSportLocation = (sportId: string, locId: string) => {
  const config = getAppConfig();
  const sport = config.sports.find((s) => s.id === sportId);
  if (sport) {
    sport.locations = sport.locations.filter((l) => l.id !== locId);
    saveAppConfig(config);
  }
};

export const addSportLessonType = (sportId: string, name: string) => {
  const config = getAppConfig();
  const sport = config.sports.find((s) => s.id === sportId);
  if (sport) {
    sport.lessonTypes.push({ id: Date.now().toString(), name });
    saveAppConfig(config);
  }
};

export const removeSportLessonType = (sportId: string, typeId: string) => {
  const config = getAppConfig();
  const sport = config.sports.find((s) => s.id === sportId);
  if (sport) {
    sport.lessonTypes = sport.lessonTypes.filter((t) => t.id !== typeId);
    saveAppConfig(config);
  }
};

export const addSportDuration = (sportId: string, minutes: number) => {
  const config = getAppConfig();
  const sport = config.sports.find((s) => s.id === sportId);
  if (sport && !sport.durations.includes(minutes)) {
    sport.durations.push(minutes);
    sport.durations.sort((a, b) => a - b);
    saveAppConfig(config);
  }
};

export const removeSportDuration = (sportId: string, minutes: number) => {
  const config = getAppConfig();
  const sport = config.sports.find((s) => s.id === sportId);
  if (sport) {
    sport.durations = sport.durations.filter((m) => m !== minutes);
    saveAppConfig(config);
  }
};
