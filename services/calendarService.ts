import { TimeSlot, Booking, CalendarEvent } from '../types';
import { getAppConfig } from './configService';
import { db } from './firebase';
import { collection, addDoc, onSnapshot, query, orderBy, where, getDocs, deleteDoc, doc, updateDoc } from 'firebase/firestore';

// --- CONFIGURAZIONE GOOGLE CALENDAR ---
const CLIENT_ID = '747839079234-9kb2r0iviapcqci554cfheaksqe3lm29.apps.googleusercontent.com'; 
const API_KEY = 'AIzaSyAv_qusWIgR7g2C1w1MeLyCNQNghZg9sWA'; 

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly'; 

const BOOKING_COLLECTION = 'bookings';

let cachedBookings: Booking[] = [];
let bookingListeners: ((bookings: Booking[]) => void)[] = [];

let tokenClient: any;
let gapiInited = false;
let gisInited = false;
let autoSyncInterval: any = null;
let initPromise: Promise<void> | null = null;

// --- REAL-TIME SUBSCRIPTION ---

export const initBookingListener = (callback?: (bookings: Booking[]) => void) => {
    if (callback) bookingListeners.push(callback);

    const q = query(collection(db, BOOKING_COLLECTION), orderBy('startTime', 'asc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
        const loadedBookings: Booking[] = [];
        snapshot.forEach(doc => {
            loadedBookings.push({ id: doc.id, ...doc.data() } as Booking);
        });
        cachedBookings = loadedBookings;
        bookingListeners.forEach(l => l(loadedBookings));
    }, (error) => {
        console.error("Errore sync prenotazioni:", error);
    });

    return unsubscribe;
};

export const getBookings = (): Booking[] => {
  return cachedBookings;
};

export const getAllCalendarEvents = (): CalendarEvent[] => {
  return cachedBookings.map(b => ({
    id: b.id,
    title: b.sportName === 'EXTERNAL_BUSY' ? 'Occupato (Google)' : `${b.sportName}: ${b.customerName}`,
    start: b.startTime,
    end: new Date(new Date(b.startTime).getTime() + b.durationMinutes * 60 * 1000).toISOString(),
    type: (b.sportName === 'EXTERNAL_BUSY' ? 'EXTERNAL_BUSY' : 'APP_BOOKING') as 'APP_BOOKING' | 'EXTERNAL_BUSY',
    description: b.notes
  })).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
};

export const saveBooking = async (booking: Booking): Promise<void> => {
  try {
      const { id, ...bookingData } = booking; 
      await addDoc(collection(db, BOOKING_COLLECTION), bookingData);
      console.log(`[Firebase] Booking saved for: ${booking.customerName}`);
  } catch (e) {
      console.error("Errore salvataggio prenotazione:", e);
      alert("Errore di rete. Riprova.");
  }
};

export const getAvailableSlots = (date: Date, durationMinutes: number, sportId: string, locationId: string): TimeSlot[] => {
  const config = getAppConfig();
  const allEvents = getAllCalendarEvents(); 
  
  // Find the specific location within the sport
  const sport = config.sports.find(s => s.id === sportId);
  if (!sport) return [];
  
  const location = sport.locations.find(l => l.id === locationId);
  if (!location) return [];

  const daysMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = daysMap[date.getDay()] as keyof typeof location.schedule;
  const daySchedule = location.schedule[dayName];

  if (!daySchedule || !daySchedule.isOpen) return [];

  const [startH, startM] = daySchedule.start.split(':').map(Number);
  const [endH, endM] = daySchedule.end.split(':').map(Number);

  const dayStart = new Date(date);
  dayStart.setHours(startH, startM, 0, 0);

  const dayEnd = new Date(date);
  dayEnd.setHours(endH, endM, 0, 0);

  const slots: TimeSlot[] = [];
  const interval = location.slotInterval; 

  const now = new Date();
  const minNoticeMinutes = config.minBookingNoticeMinutes || 0;
  const earliestAllowedTime = new Date(now.getTime() + minNoticeMinutes * 60000);

  let currentSlotStart = new Date(dayStart);

  while (currentSlotStart < dayEnd) {
      const currentSlotEnd = new Date(currentSlotStart.getTime() + durationMinutes * 60000);

      if (currentSlotEnd > dayEnd) break; 

      const slotId = `${date.toISOString().split('T')[0]}-${locationId}-${currentSlotStart.getHours()}-${currentSlotStart.getMinutes()}`;

      // Controllo sovrapposizioni
      // 1. Eventi (Booking o Busy) che si sovrappongono a questo slot
      const isBusy = allEvents.some(event => {
          const eventStart = new Date(event.start).getTime();
          const eventEnd = new Date(event.end).getTime();
          const slotStartTime = currentSlotStart.getTime();
          const slotEndTime = currentSlotEnd.getTime();
          return (eventStart < slotEndTime && eventEnd > slotStartTime);
      });

      const isTooSoon = currentSlotStart < earliestAllowedTime;

      slots.push({
          id: slotId,
          startTime: currentSlotStart.toISOString(),
          endTime: currentSlotEnd.toISOString(),
          isAvailable: !isBusy && !isTooSoon
      });

      currentSlotStart = new Date(currentSlotStart.getTime() + interval * 60000);
  }

  return slots;
};

// --- GOOGLE CALENDAR INTEGRATION (REAL) ---

const waitForGoogleScripts = (): Promise<void> => {
    return new Promise((resolve) => {
        const check = () => {
            if ((window as any).google && (window as any).gapi) {
                resolve();
            } else {
                setTimeout(check, 100);
            }
        };
        check();
    });
};

export const initGoogleClient = async (): Promise<void> => {
    if (initPromise) return initPromise;

    initPromise = new Promise(async (resolve) => {
        await waitForGoogleScripts();
        
        const gapi = (window as any).gapi;
        const google = (window as any).google;

        // 1. Initialize Identity Service (Token Client) FIRST
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: '', // Defined dynamically
        });
        gisInited = true;

        // 2. Initialize GAPI Client
        gapi.load('client', async () => {
            try {
              await gapi.client.init({
                  apiKey: API_KEY,
                  discoveryDocs: [DISCOVERY_DOC],
              });
              gapiInited = true;

              // 3. ONLY AFTER BOTH ARE READY -> Attempt Restore
              const wasConnected = localStorage.getItem('courtmaster_gcal_token') === 'true';
              if (wasConnected) {
                  console.log("Ripristino sessione Google in corso...");
                  try {
                       // Override callback temporary for silent restore
                       const originalCallback = tokenClient.callback;
                       tokenClient.callback = (resp: any) => {
                           if (resp.error) {
                               console.warn("Silent restore failed:", resp);
                           } else {
                               console.log("Sessione Google ripristinata.");
                           }
                           resolve();
                       };
                       // Request with empty prompt for silent refresh
                       tokenClient.requestAccessToken({prompt: ''});
                  } catch (e) {
                      console.warn("Errore token restore:", e);
                      resolve();
                  }
              } else {
                  resolve();
              }

            } catch (e) {
              console.error("Errore GAPI Init:", e);
              resolve();
            }
        });
    });
    
    return initPromise;
};

export const isCalendarConnected = (): boolean => {
  return localStorage.getItem('courtmaster_gcal_token') === 'true';
};

export const connectGoogleCalendar = async (): Promise<boolean> => {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
        // Retry logic: if called too early, try waiting a moment
        console.warn("TokenClient not ready, retrying...");
        setTimeout(() => {
             if(tokenClient) {
                 connectGoogleCalendar().then(resolve).catch(reject);
             } else {
                 alert("Configurazione Google non ancora caricata. Riprova tra un istante.");
                 reject(false);
             }
        }, 1000);
        return;
    }

    tokenClient.callback = async (resp: any) => {
      if (resp.error) {
        reject(resp);
        return;
      }
      localStorage.setItem('courtmaster_gcal_token', 'true');
      startAutoSync(); // Avvia sync automatico
      resolve(true);
    };

    if ((window as any).gapi.client.getToken() === null) {
      tokenClient.requestAccessToken({prompt: 'consent'});
    } else {
      tokenClient.requestAccessToken({prompt: ''});
    }
  });
};

export const disconnectGoogleCalendar = () => {
  stopAutoSync();
  const google = (window as any).google;
  const gapi = (window as any).gapi;
  if(google) {
      try {
        google.accounts.oauth2.revoke(localStorage.getItem('courtmaster_gcal_token'), () => {console.log('Revoked')});
      } catch (e) {}
  }
  if (gapi && gapi.client) {
      gapi.client.setToken(null);
  }
  localStorage.removeItem('courtmaster_gcal_token');
};

export const listGoogleCalendars = async (): Promise<{id: string, summary: string, primary?: boolean}[]> => {
    const gapi = (window as any).gapi;
    // Check if client is ready
    if (!gapi || !gapi.client) return []; 
    
    // Lista calendari richiede AUTH.
    if (gapi.client.getToken() === null) {
        // Se pensiamo di essere connessi ma non abbiamo il token, forse il restore è fallito o non ancora avvenuto
        return [];
    }

    try {
        const response = await gapi.client.calendar.calendarList.list();
        return response.result.items.map((item: any) => ({
            id: item.id,
            summary: item.summary,
            primary: item.primary
        }));
    } catch (error: any) {
        if (error.status === 401) {
            handleAuthError();
        }
        console.error("Errore lista calendari:", error);
        throw error;
    }
}

// --- AUTO SYNC LOGIC ---

export const startAutoSync = () => {
    if (autoSyncInterval) clearInterval(autoSyncInterval);
    
    console.log("Avvio Auto-Sync Google Calendar...");
    // Primo sync immediato
    syncGoogleEventsToFirebase(undefined, true).catch(() => {});
    
    // Se siamo loggati (abbiamo il token), proviamo anche a esportare le prenotazioni pendenti
    if (isCalendarConnected()) {
         exportBookingsToGoogle().catch(err => console.log("Export background fallito (probabilmente token scaduto o guest)", err));
    }

    // Sync ogni 5 minuti
    autoSyncInterval = setInterval(() => {
        syncGoogleEventsToFirebase(undefined, true).catch(err => console.warn("Auto-sync fallito", err));
    }, 5 * 60 * 1000); 
};

export const stopAutoSync = () => {
    if (autoSyncInterval) {
        clearInterval(autoSyncInterval);
        autoSyncInterval = null;
    }
}

const handleAuthError = () => {
    console.warn("Sessione Google scaduta o invalida.");
};

export const syncGoogleEventsToFirebase = async (calendarIds: string[] = [], silent = false) => {
    const gapi = (window as any).gapi;
    if (!gapi || !gapi.client) {
         if (!silent) throw new Error("GAPI non pronto");
         return 0;
    }
    
    const config = getAppConfig();
    
    // 1. RACCOLTA CALENDARI DA CONTROLLARE
    // Iniziamo con quelli selezionati manualmente nella lista "Occupati"
    const manualCalendars = calendarIds.length > 0 ? calendarIds : (config.importBusyCalendars || []);
    
    // Usiamo un Set per evitare duplicati
    const targetCalendarsSet = new Set<string>(manualCalendars);

    // INTELLIGENZA: Aggiungiamo AUTOMATICAMENTE i calendari configurati nelle Sedi/Offerte
    // Se un utente ha configurato un calendario per ricevere prenotazioni, deve anche essere controllato per le sovrapposizioni!
    if (config.sports) {
        config.sports.forEach(sport => {
            if (sport.locations) {
                sport.locations.forEach(loc => {
                    if (loc.googleCalendarId) {
                        targetCalendarsSet.add(loc.googleCalendarId);
                    }
                });
            }
        });
    }

    let targetCalendars = Array.from(targetCalendarsSet);
    
    // --- LOGICA GESTIONE GUEST VS ADMIN ---
    const isAuthenticated = gapi.client.getToken() !== null;

    if (!isAuthenticated) {
        // Se siamo GUEST, non possiamo accedere a 'primary'.
        // Filtriamo via 'primary' dalla lista.
        targetCalendars = targetCalendars.filter(id => id !== 'primary');
        
        if (targetCalendars.length === 0) {
            // Se non ci sono calendari pubblici specifici, usciamo in silenzio.
            // Questo previene l'errore "Calendario non trovato: primary".
            if (!silent) console.log("Guest Sync: Nessun calendario pubblico configurato. Salto sync.");
            return 0;
        }
    } else {
        // Se siamo ADMIN loggati e la lista è vuota, usiamo di default 'primary' (il tuo calendario personale)
        if (targetCalendars.length === 0) {
            targetCalendars = ['primary'];
        }
    }

    const now = new Date();
    const nextMonth = new Date();
    nextMonth.setDate(nextMonth.getDate() + 30);

    try {
        // 1. Scarica nuovi eventi da Google
        let allGoogleEvents: any[] = [];
        let hasReadErrors = false;
        
        for (const calId of targetCalendars) {
            try {
                const response = await gapi.client.calendar.events.list({
                    'calendarId': calId,
                    'timeMin': now.toISOString(),
                    'timeMax': nextMonth.toISOString(),
                    'showDeleted': false,
                    'singleEvents': true,
                    'orderBy': 'startTime'
                });
                if (response.result.items) {
                    allGoogleEvents = [...allGoogleEvents, ...response.result.items];
                }
            } catch (e: any) {
                // Gestione specifica errori
                if (e.status === 401 || e.status === 403) {
                     if (!silent) console.warn(`Impossibile leggere calendario ${calId} (Privato/No Auth)`);
                     hasReadErrors = true;
                } else if (e.status === 404) {
                    if (!silent) console.warn(`Calendario non trovato: ${calId}`);
                } else {
                    console.warn(`Errore generico lettura calendario ${calId}:`, e);
                }
            }
        }

        if (allGoogleEvents.length === 0 && hasReadErrors) {
            return 0;
        }

        // 2. Pulisci vecchi eventi importati SU FIREBASE
        if (allGoogleEvents.length > 0 || (!hasReadErrors && targetCalendars.length > 0)) {
            const q = query(collection(db, BOOKING_COLLECTION), where("sportName", "==", "EXTERNAL_BUSY"));
            const snapshot = await getDocs(q);
            const deletePromises = snapshot.docs.map(d => deleteDoc(doc(db, BOOKING_COLLECTION, d.id)));
            await Promise.all(deletePromises);
        } else {
            return 0;
        }

        // 3. Salva su Firebase
        const addPromises = allGoogleEvents.map((ev: any) => {
            if (!ev.start.dateTime) return Promise.resolve(); // Salta eventi tutto il giorno se non gestiti
            
            const start = new Date(ev.start.dateTime);
            const end = new Date(ev.end.dateTime);
            const duration = (end.getTime() - start.getTime()) / 60000;

            const busyBlock: Booking = {
                id: `gcal_${ev.id}`, 
                sportId: 'external',
                sportName: 'EXTERNAL_BUSY',
                locationId: 'all', 
                locationName: 'Google Calendar',
                durationMinutes: duration,
                date: start.toISOString().split('T')[0],
                timeSlotId: 'external',
                startTime: start.toISOString(),
                customerName: ev.summary || 'Impegno Google',
                customerEmail: '',
                skillLevel: 'Beginner'
            };
            
            return addDoc(collection(db, BOOKING_COLLECTION), busyBlock);
        });

        await Promise.all(addPromises);
        return allGoogleEvents.length;

    } catch (error) {
        if (!silent) console.error("Errore Sync Google:", error);
        throw error;
    }
};

export const exportBookingsToGoogle = async (defaultCalendarId: string = 'primary'): Promise<number> => {
    const gapi = (window as any).gapi;
    if (!gapi || !gapi.client || gapi.client.getToken() === null) {
        return 0;
    }

    const config = getAppConfig();
    
    // Filtra prenotazioni future non ancora sincronizzate
    const unsyncedBookings = cachedBookings.filter(b => 
        !b.googleEventId && 
        b.sportName !== 'EXTERNAL_BUSY' && 
        new Date(b.startTime) > new Date()
    );

    if (unsyncedBookings.length === 0) return 0;
    console.log(`Trovate ${unsyncedBookings.length} prenotazioni da esportare su Google...`);

    let successCount = 0;

    for (const booking of unsyncedBookings) {
        try {
            // LOGICA: Cerca il calendario specifico per Sport -> Location
            let targetCalendarId = defaultCalendarId;
            
            const sport = config.sports.find(s => s.id === booking.sportId);
            if (sport) {
                const location = sport.locations.find(l => l.id === booking.locationId);
                if (location && location.googleCalendarId) {
                    targetCalendarId = location.googleCalendarId;
                }
            }

            const event = {
                'summary': `🎾 ${booking.sportName}: ${booking.customerName}`,
                'location': booking.locationName,
                'description': `Cliente: ${booking.customerName} (${booking.customerEmail})\nTelefono: ${booking.customerPhone || 'N/A'}\nTipo: ${booking.lessonTypeName || 'Standard'}\nLivello: ${booking.skillLevel}\nNote: ${booking.notes || 'Nessuna'}\n\nPiano AI: ${booking.aiLessonPlan?.substring(0, 100)}...`,
                'start': {
                    'dateTime': booking.startTime, 
                },
                'end': {
                    'dateTime': new Date(new Date(booking.startTime).getTime() + booking.durationMinutes * 60000).toISOString(), 
                }
            };

            const response = await gapi.client.calendar.events.insert({
                'calendarId': targetCalendarId,
                'resource': event
            });

            if (response.result && response.result.id) {
                const bookingRef = doc(db, BOOKING_COLLECTION, booking.id);
                await updateDoc(bookingRef, { 
                    googleEventId: response.result.id,
                    targetCalendarId: targetCalendarId
                });
                successCount++;
            }

        } catch (error: any) {
            if (error.status === 401) {
                handleAuthError();
                break;
            }
            console.error(`Errore export prenotazione ${booking.customerName}:`, error);
        }
    }

    return successCount;
};