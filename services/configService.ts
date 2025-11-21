
import { AppConfig, Sport, SportLocation, WeeklySchedule, LessonType } from '../types';
import { db } from './firebase';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';

const CONFIG_DOC_ID = 'global_settings';
const CONFIG_COLLECTION = 'settings';

const DEFAULT_SCHEDULE: WeeklySchedule = {
  monday: { isOpen: true, start: '09:00', end: '22:00' },
  tuesday: { isOpen: true, start: '09:00', end: '22:00' },
  wednesday: { isOpen: true, start: '09:00', end: '22:00' },
  thursday: { isOpen: true, start: '09:00', end: '22:00' },
  friday: { isOpen: true, start: '09:00', end: '22:00' },
  saturday: { isOpen: true, start: '09:00', end: '18:00' },
  sunday: { isOpen: false, start: '09:00', end: '13:00' },
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
                slotInterval: 60, // Usually shorter for Padel
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

// Cache locale
let currentConfig: AppConfig = { ...DEFAULT_CONFIG };
let listeners: ((config: AppConfig) => void)[] = [];

// Inizializza l'ascolto Real-time da Firebase
export const initConfigListener = (callback?: (config: AppConfig) => void) => {
  if (callback) listeners.push(callback);

  const unsubscribe = onSnapshot(doc(db, CONFIG_COLLECTION, CONFIG_DOC_ID), (docSnap) => {
    if (docSnap.exists()) {
      const data = docSnap.data();
      // Merge con default
      currentConfig = { ...DEFAULT_CONFIG, ...data } as AppConfig;
      
      // Data Migration Logic: Ensure new nested structure exists if migrating from old version
      if (!currentConfig.sports) currentConfig.sports = [];
      
      currentConfig.sports = currentConfig.sports.map(s => ({
          ...s,
          locations: s.locations || [],
          lessonTypes: s.lessonTypes || [],
          durations: s.durations || [60]
      }));

    } else {
      setDoc(doc(db, CONFIG_COLLECTION, CONFIG_DOC_ID), DEFAULT_CONFIG);
      currentConfig = DEFAULT_CONFIG;
    }
    
    listeners.forEach(l => l(currentConfig));
  }, (error) => {
      console.error("Errore connessione Firebase Config:", error);
  });

  return unsubscribe;
};

export const getAppConfig = (): AppConfig => {
  return currentConfig;
};

// --- UPDATE FUNCTIONS ---

export const saveAppConfig = async (config: AppConfig) => {
  try {
    const cleanConfig = JSON.parse(JSON.stringify(config));
    await setDoc(doc(db, CONFIG_COLLECTION, CONFIG_DOC_ID), cleanConfig);
  } catch (e) {
    console.error("Errore salvataggio config:", e);
    alert("Errore nel salvataggio online. Verifica la connessione.");
  }
};

export const updateHomeConfig = (title: string, subtitle: string) => {
  const config = getAppConfig();
  config.homeTitle = title;
  config.homeSubtitle = subtitle;
  saveAppConfig(config);
}

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
        lessonTypes: [{id: 'def_1', name: 'Lezione Standard'}],
        durations: [60]
    });
    saveAppConfig(config);
}

export const updateSport = (sportId: string, updates: Partial<Sport>) => {
    const config = getAppConfig();
    const index = config.sports.findIndex(s => s.id === sportId);
    if (index !== -1) {
        config.sports[index] = { ...config.sports[index], ...updates };
        saveAppConfig(config);
    }
};

export const removeSport = (sportId: string) => {
    const config = getAppConfig();
    config.sports = config.sports.filter(s => s.id !== sportId);
    saveAppConfig(config);
};

// --- NESTED CONFIG MANAGEMENT (Locations, Types, Durations INSIDE Sport) ---

export const addSportLocation = (sportId: string, name: string, address: string) => {
    const config = getAppConfig();
    const sport = config.sports.find(s => s.id === sportId);
    if (sport) {
        sport.locations.push({
            id: Date.now().toString(),
            name,
            address,
            schedule: JSON.parse(JSON.stringify(DEFAULT_SCHEDULE)),
            slotInterval: 60,
            googleCalendarId: ''
        });
        saveAppConfig(config);
    }
}

export const updateSportLocation = (sportId: string, locId: string, updates: Partial<SportLocation>) => {
    const config = getAppConfig();
    const sport = config.sports.find(s => s.id === sportId);
    if (sport) {
        const locIndex = sport.locations.findIndex(l => l.id === locId);
        if (locIndex !== -1) {
            sport.locations[locIndex] = { ...sport.locations[locIndex], ...updates };
            saveAppConfig(config);
        }
    }
}

export const removeSportLocation = (sportId: string, locId: string) => {
    const config = getAppConfig();
    const sport = config.sports.find(s => s.id === sportId);
    if (sport) {
        sport.locations = sport.locations.filter(l => l.id !== locId);
        saveAppConfig(config);
    }
}

export const addSportLessonType = (sportId: string, name: string) => {
    const config = getAppConfig();
    const sport = config.sports.find(s => s.id === sportId);
    if (sport) {
        sport.lessonTypes.push({
            id: Date.now().toString(),
            name
        });
        saveAppConfig(config);
    }
}

export const removeSportLessonType = (sportId: string, typeId: string) => {
    const config = getAppConfig();
    const sport = config.sports.find(s => s.id === sportId);
    if (sport) {
        sport.lessonTypes = sport.lessonTypes.filter(t => t.id !== typeId);
        saveAppConfig(config);
    }
}

export const addSportDuration = (sportId: string, minutes: number) => {
    const config = getAppConfig();
    const sport = config.sports.find(s => s.id === sportId);
    if (sport && !sport.durations.includes(minutes)) {
        sport.durations.push(minutes);
        sport.durations.sort((a, b) => a - b);
        saveAppConfig(config);
    }
}

export const removeSportDuration = (sportId: string, minutes: number) => {
    const config = getAppConfig();
    const sport = config.sports.find(s => s.id === sportId);
    if (sport) {
        sport.durations = sport.durations.filter(m => m !== minutes);
        saveAppConfig(config);
    }
}
