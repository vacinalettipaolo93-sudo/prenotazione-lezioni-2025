
import { AppConfig, Sport, Location, LessonDuration, WeeklySchedule } from '../types';
import { db } from './firebase';
import { doc, setDoc, onSnapshot, getDoc } from 'firebase/firestore';

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
  sports: [
    { id: '1', name: 'Tennis', emoji: '🎾', description: 'Migliora il tuo dritto e rovescio.' },
    { id: '2', name: 'Padel', emoji: '🏸', description: 'Vetri, griglie e bandeja.' }
  ],
  locations: [
    { 
      id: '1', 
      name: 'Club Centrale', 
      address: 'Via Roma 10',
      schedule: JSON.parse(JSON.stringify(DEFAULT_SCHEDULE)), 
      slotInterval: 60,
      googleCalendarId: ''
    },
    { 
      id: '2', 
      name: 'Circolo Nord', 
      address: 'Via Milano 42',
      schedule: JSON.parse(JSON.stringify(DEFAULT_SCHEDULE)), 
      slotInterval: 30,
      googleCalendarId: ''
    }
  ],
  durations: [
    { minutes: 60, label: '1 Ora' },
    { minutes: 90, label: '1 Ora e mezza' }
  ],
  minBookingNoticeMinutes: 60 // Default 1 ora di preavviso
};

// Cache locale per accesso sincrono nell'UI mentre i dati si aggiornano
let currentConfig: AppConfig = { ...DEFAULT_CONFIG };
let listeners: ((config: AppConfig) => void)[] = [];

// Inizializza l'ascolto Real-time da Firebase
export const initConfigListener = (callback?: (config: AppConfig) => void) => {
  if (callback) listeners.push(callback);

  const unsubscribe = onSnapshot(doc(db, CONFIG_COLLECTION, CONFIG_DOC_ID), (docSnap) => {
    if (docSnap.exists()) {
      const data = docSnap.data();
      // Merge con default per evitare campi mancanti se la struttura cambia
      currentConfig = { ...DEFAULT_CONFIG, ...data } as AppConfig;
      
      // Patch per schedule mancanti in vecchi dati
      if (currentConfig.locations) {
        currentConfig.locations = currentConfig.locations.map(l => ({
            ...l,
            schedule: l.schedule || JSON.parse(JSON.stringify(DEFAULT_SCHEDULE)),
            slotInterval: l.slotInterval || 60,
            googleCalendarId: l.googleCalendarId || ''
        }));
      }
      // Patch per minBookingNoticeMinutes mancante in vecchi dati
      if (currentConfig.minBookingNoticeMinutes === undefined) {
        currentConfig.minBookingNoticeMinutes = 60;
      }
      
      // Patch per sports mancanti
      if (!currentConfig.sports) currentConfig.sports = [];

    } else {
      // Se non esiste, crea il default su Firebase
      setDoc(doc(db, CONFIG_COLLECTION, CONFIG_DOC_ID), DEFAULT_CONFIG);
      currentConfig = DEFAULT_CONFIG;
    }
    
    // Notifica tutti i listener
    listeners.forEach(l => l(currentConfig));
  }, (error) => {
      console.error("Errore connessione Firebase Config:", error);
  });

  return unsubscribe;
};

// Accesso sincrono (usa la cache aggiornata dal listener)
export const getAppConfig = (): AppConfig => {
  return currentConfig;
};

// --- UPDATE FUNCTIONS (Scrivono su Firebase) ---

export const saveAppConfig = async (config: AppConfig) => {
  try {
    // Create a deep copy to ensure we're not passing references that might confuse Firestore SDK
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

export const updateLocationSchedule = (locationId: string, schedule: WeeklySchedule, interval: 30 | 60) => {
  const config = getAppConfig();
  const locIndex = config.locations.findIndex(l => l.id === locationId);
  if (locIndex !== -1) {
      config.locations[locIndex].schedule = schedule;
      config.locations[locIndex].slotInterval = interval;
      saveAppConfig(config);
  }
}

export const updateLocationDetails = (locationId: string, updates: Partial<Location>) => {
    const config = getAppConfig();
    const locIndex = config.locations.findIndex(l => l.id === locationId);
    if (locIndex !== -1) {
        config.locations[locIndex] = { ...config.locations[locIndex], ...updates };
        saveAppConfig(config);
    }
}

// --- SPORTS MANAGEMENT ---

export const addSport = (sport: Sport) => {
  const config = getAppConfig();
  // Ensure sports array exists
  if (!config.sports) config.sports = [];
  
  config.sports.push(sport);
  saveAppConfig(config);
};

export const updateSport = (sportId: string, updates: Partial<Sport>) => {
    const config = getAppConfig();
    const index = config.sports.findIndex(s => s.id === sportId);
    if (index !== -1) {
        config.sports[index] = { ...config.sports[index], ...updates };
        saveAppConfig(config);
    }
};

export const removeSport = (id: string) => {
  const config = getAppConfig();
  config.sports = config.sports.filter(s => s.id !== id);
  saveAppConfig(config);
};

// --- LOCATION MANAGEMENT ---

export const addLocation = (locationPartial: Pick<Location, 'id' | 'name' | 'address'>) => {
  const config = getAppConfig();
  if (!config.locations) config.locations = [];

  const newLocation: Location = {
      ...locationPartial,
      schedule: JSON.parse(JSON.stringify(DEFAULT_SCHEDULE)),
      slotInterval: 60,
      googleCalendarId: ''
  };
  config.locations.push(newLocation);
  saveAppConfig(config);
};

export const removeLocation = (id: string) => {
  const config = getAppConfig();
  config.locations = config.locations.filter(l => l.id !== id);
  saveAppConfig(config);
};

// --- DURATION MANAGEMENT ---

export const addDuration = (duration: LessonDuration) => {
  const config = getAppConfig();
  if (!config.durations) config.durations = [];

  if (!config.durations.some(d => d.minutes === duration.minutes)) {
    config.durations.push(duration);
    config.durations.sort((a, b) => a.minutes - b.minutes);
    saveAppConfig(config);
  }
};

export const removeDuration = (minutes: number) => {
  const config = getAppConfig();
  config.durations = config.durations.filter(d => d.minutes !== minutes);
  saveAppConfig(config);
};
