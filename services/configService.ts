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

/**
 * Normalizza e “ripara” una config letta da Firestore:
 * - merge con default
 * - assicura sports/locations/exceptions
 * - evita undefined che poi possono essere salvati male
 */
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

/**
 * Valida “minimamente” prima di salvare, per evitare reset accidentali.
 * Se vuoi essere ancora più severo, possiamo aggiungere controlli.
 */
const validateBeforeSave = (config: AppConfig) => {
  if (!config) throw new Error('Config mancante');

  // Evita salvataggi che azzerano sport per errore (caso tipico)
  if (!Array.isArray(config.sports)) {
    throw new Error('Config non valida: sports non è un array');
  }
  // Se vuoi permettere sports vuoto, togli questo controllo.
  // Io lo lascio per sicurezza.
  if (config.sports.length === 0) {
    throw new Error('Bloccato salvataggio: sports è vuoto (rischio reset).');
  }
};

// -------------------------
// Cache + Listener
// -------------------------

let currentConfig: AppConfig = deepClone(DEFAULT_CONFIG);
let listeners: ((config: AppConfig) => void)[] = [];

/**
 * Inizializza l’ascolto Real-time da Firebase.
 * MODIFICA SICURA:
 * - se il doc NON esiste, NON scrive più DEFAULT_CONFIG automaticamente (evita reset a sorpresa).
 *   Invece mantiene la config locale default e logga un warning.
 */
export const initConfigListener = (callback?: (config: AppConfig) => void) => {
  if (callback) listeners.push(callback);

  const ref = doc(db, CONFIG_COLLECTION, CONFIG_DOC_ID);

  const unsubscribe = onSnapshot(
    ref,
    (docSnap) => {
      if (docSnap.exists()) {
        currentConfig = normalizeConfig(docSnap.data());
      } else {
        console.warn(
          `[Firebase] Documento config mancante: ${CONFIG_COLLECTION}/${CONFIG_DOC_ID}. ` +
          `Non inizializzo automaticamente DEFAULT_CONFIG per evitare reset.`
        );
        currentConfig = deepClone(DEFAULT_CONFIG);
      }

      listeners.forEach((l) => l(currentConfig));
    },
    (error) => {
      console.error('Errore connessione Firebase Config:', error);
    }
  );

  return unsubscribe;
};

export const getAppConfig = (): AppConfig => {
  return currentConfig;
};

// -------------------------
// Salvataggio (SAFE)
// -------------------------

/**
 * Salva la config in modo sicuro:
 * - normalizza
 * - valida
 * - setDoc con { merge: true } per NON rimpiazzare tutto il documento
 */
export const saveAppConfig = async (config: AppConfig) => {
  try {
    const normalized = normalizeConfig(config);
    validateBeforeSave(normalized);

    const cleanConfig = JSON.parse(JSON.stringify(normalized));

    await setDoc(
      doc(db, CONFIG_COLLECTION, CONFIG_DOC_ID),
      cleanConfig,
      { merge: true } // <-- IMPORTANTISSIMO: evita cancellazioni
    );
  } catch (e) {
    console.error('Errore salvataggio config:', e);
    alert('Errore nel salvataggio online. Verifica la connessione.');
    throw e; // utile se vuoi gestire errori a livello UI
  }
};

/**
 * Inizializzazione manuale (solo se vuoi un bottone “Ripristina Default”)
 * Usa merge:false apposta perché è una scelta VOLUTA.
 */
export const forceResetToDefaultConfig = async () => {
  const clean = JSON.parse(JSON.stringify(deepClone(DEFAULT_CONFIG)));
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

      if (schedule === null) {
        delete loc.scheduleExceptions[date];
      } else {
        loc.scheduleExceptions[date] = schedule;
      }

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
        if (schedule === null) {
          delete loc.scheduleExceptions[date];
        } else {
          loc.scheduleExceptions[date] = { ...schedule };
        }
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
    sport.lessonTypes.push({
      id: Date.now().toString(),
      name
    });
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
