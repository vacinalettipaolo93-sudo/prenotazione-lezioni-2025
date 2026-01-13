import { TimeSlot, Booking, CalendarEvent, DailySchedule } from '../types';
import { getAppConfig } from './configService';
import { db } from './firebase';
import { collection, addDoc, onSnapshot, query, orderBy, where, getDocs, deleteDoc, doc, updateDoc, getDoc } from 'firebase/firestore';

// --- CONFIGURAZIONE GOOGLE CALENDAR ---
const CLIENT_ID = '747839079234-9kb2r0iviapcqci554cfheaksqe3lm29.apps.googleusercontent.com'; 
const API_KEY = 'AIzaSyAv_qusWIgR7g2C1w1MeLyCNQNghZg9sWA'; 

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly'; 

const BOOKING_COLLECTION = 'bookings';

let cachedBookings: Booking[] = [];

let tokenClient: any;
let gapiInited = false;
let gisInited = false;
let autoSyncInterval: any = null;
let initPromise: Promise<void> | null = null;

// --- REAL-TIME SUBSCRIPTION ---

export const initBookingListener = (callback: (bookings: Booking[]) => void) => {
    // Initial fetch from cache if available to prevent empty flash
    if (cachedBookings.length > 0) {
        callback(cachedBookings);
    }
    
    const q = query(collection(db, BOOKING_COLLECTION), orderBy('startTime', 'asc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
        const loadedBookings: Booking[] = [];
        snapshot.forEach(doc => {
            loadedBookings.push({ id: doc.id, ...doc.data() } as Booking);
        });
        cachedBookings = loadedBookings;
        callback(loadedBookings);
    }, (error) => {
        console.error("Errore sync prenotazioni:", error);
    });

    return unsubscribe;
};

export const getBookings = (): Booking[] => {
  return cachedBookings;
};

// --- DELETE OPERATIONS ---

export const deleteGoogleEvent = async (calendarId: string, eventId: string) => {
    const gapi = (window as any).gapi;
    if (!gapi || !gapi.client || gapi.client.getToken() === null) return;
    try {
        await gapi.client.calendar.events.delete({
            calendarId: calendarId,
            eventId: eventId
        });
        console.log("Evento Google eliminato correttamente.");
    } catch (e) {
        console.warn("Impossibile eliminare evento Google (forse già cancellato o permessi mancanti)", e);
    }
}

export const deleteBooking = async (bookingId: string): Promise<void> => {
    try {
        // 1. Recupera la prenotazione per vedere se è collegata a Google
        const docRef = doc(db, BOOKING_COLLECTION, bookingId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data() as Booking;
            // 2. Se c'è un ID evento Google, prova a eliminarlo dal calendario
            if (data.googleEventId && data.targetCalendarId) {
                await deleteGoogleEvent(data.targetCalendarId, data.googleEventId);
            }
        }

        // 3. Elimina dal database Firebase
        await deleteDoc(docRef);
        console.log(`Prenotazione ${bookingId} eliminata dal DB.`);
    } catch (error) {
        console.error("Errore eliminazione prenotazione:", error);
        throw error;
    }
};

export const updateBooking = async (bookingId: string, updates: Partial<Booking>): Promise<void> => {
    try {
        const bookingRef = doc(db, BOOKING_COLLECTION, bookingId);
        await updateDoc(bookingRef, updates);
        console.log(`Prenotazione ${bookingId} aggiornata.`);
    } catch (error) {
        console.error("Errore aggiornamento prenotazione:", error);
        throw error;
    }
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

/**
 * getAvailableSlots
 * - Supports multiple periods per day stored in location.schedule (periods array) or in scheduleExceptions.
 * - Falls back to legacy start/end if periods are not present.
 * - Checks existing bookings (cachedBookings) for collisions using booking.locationId and date overlap.
 */
export const getAvailableSlots = (date: Date, durationMinutes: number, sportId: string, locationId: string, lessonTypeId?: string): TimeSlot[] => {
  const config = getAppConfig();
  
  // Find the specific location within the sport
  const sport = config.sports.find(s => s.id === sportId);
  if (!sport) return [];
  
  const location = sport.locations.find(l => l.id === locationId);
  if (!location) return [];

  // --- LOGICA ORARI ---
  // 1. Controlla se c'è un'eccezione per questa data specifica (YYYY-MM-DD)
  const dateString = date.toISOString().split('T')[0];
  let daySchedule: DailySchedule | undefined = location.scheduleExceptions?.[dateString];

  // 2. Se non c'è eccezione, usa l'orario settimanale standard
  if (!daySchedule) {
      const daysMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayName = daysMap[date.getDay()] as keyof typeof location.schedule;
      daySchedule = location.schedule[dayName];
  }

  // Se il giorno è chiuso
  if (!daySchedule || !daySchedule.isOpen) return [];

  // Se è stato richiesto un tipo di lezione specifico, controlla se è permesso oggi
  if (lessonTypeId && daySchedule.allowedLessonTypeIds && daySchedule.allowedLessonTypeIds.length > 0) {
      if (!daySchedule.allowedLessonTypeIds.includes(lessonTypeId)) {
          return []; // Il tipo di lezione non è permesso in questo giorno
      }
  }

  // Normalize periods: preferisci daySchedule.periods (nuovo schema), fallback a start/end (schema vecchio)
  const periods: { start: string; end: string }[] = (daySchedule as any).periods && Array.isArray((daySchedule as any).periods) && (daySchedule as any).periods.length > 0
    ? (daySchedule as any).periods.map((p: any) => ({ start: p.start, end: p.end }))
    : (daySchedule.start && daySchedule.end) ? [{ start: daySchedule.start, end: daySchedule.end }] : [];

  if (periods.length === 0) return [];

  const slots: TimeSlot[] = [];
  const interval = location.slotInterval || 30; 

  const now = new Date();
  
  // LOGICA PREAVVISO MINIMO
  const minNoticeMinutes = Number(config.minBookingNoticeMinutes) || 0;

  // Prepare bookings to check collisions: only bookings for this location and the selected date
  const bookingsForDate = cachedBookings.filter(b => {
    const bDate = b.date || (new Date(b.startTime).toISOString().split('T')[0]);
    return b.locationId === locationId && bDate === dateString;
  });

  // For each period, generate slots
  for (const p of periods) {
    // Parse hh:mm to numbers
    const [startH, startM] = p.start.split(':').map(Number);
    const [endH, endM] = p.end.split(':').map(Number);

    const periodStart = new Date(date);
    periodStart.setHours(startH, startM, 0, 0);

    const periodEnd = new Date(date);
    periodEnd.setHours(endH, endM, 0, 0);

    // if period ends before it starts skip
    if (periodEnd <= periodStart) continue;

    // Create slots inside this period
    let slotStart = new Date(periodStart);
    while (new Date(slotStart.getTime() + durationMinutes * 60 * 1000) <= periodEnd) {
      const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000);

      // Check min notice
      if (slotStart.getTime() - now.getTime() < minNoticeMinutes * 60 * 1000) {
        slotStart = new Date(slotStart.getTime() + interval * 60 * 1000);
        continue;
      }

      // Check collisions with bookingsForDate (overlap check)
      const collides = bookingsForDate.some(b => {
        const bStart = new Date(b.startTime).getTime();
        const bEnd = bStart + (b.durationMinutes || 0) * 60000;
        return !(slotEnd.getTime() <= bStart || slotStart.getTime() >= bEnd);
      });

      const id = `${dateString} ${slotStart.toISOString()}-${slotEnd.toISOString()}`;
      slots.push({
        id,
        startTime: slotStart.toISOString(),
        endTime: slotEnd.toISOString(),
        isAvailable: !collides
      });

      // advance by interval (non-overlapping sliding window)
      slotStart = new Date(slotStart.getTime() + interval * 60 * 1000);
    }
  }

  // Optional: sort slots by start time
  slots.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

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

        // 1. Initialize Identity Service FIRST (for restoring session)
        if (!gisInited) {
            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID,
                scope: SCOPES,
                callback: '', // Defined dynamically
            });
            gisInited = true;
        }

        // 2. Initialize GAPI Client
        if (!gapiInited) {
             gapi.load('client', async () => {
                try {
                  await gapi.client.init({
                      apiKey: API_KEY,
                      discoveryDocs: [DISCOVERY_DOC],
                  });
                  gapiInited = true;

                  // 3. ATTEMPT RESTORE
                  const wasConnected = localStorage.getItem('courtmaster_gcal_token') === 'true';
                  if (wasConnected) {
                      console.log("Ripristino sessione Google in corso...");
                      try {
                           const originalCallback = tokenClient.callback;
                           tokenClient.callback = (resp: any) => {
                               if (resp.error) {
                                   console.warn("Restore failed:", resp);
                                   localStorage.removeItem('courtmaster_gcal_token');
                               } else {
                                   console.log("Sessione Google ripristinata.");
                               }
                               resolve();
                           };
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
        } else {
            resolve();
        }
    });
    
    return initPromise;
};

export const isCalendarConnected = (): boolean => {
  return localStorage.getItem('courtmaster_gcal_token') === 'true';
};

export const connectGoogleCalendar = async (): Promise<boolean> => {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
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
    if (!gapi || !gapi.client) return []; 
    
    if (gapi.client.getToken() === null) {
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
    syncGoogleEventsToFirebase(undefined, true).catch(() => {});
    
    if (isCalendarConnected()) {
         exportBookingsToGoogle().catch(err => console.log("Export background fallito", err));
    }

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
    const manualCalendars = calendarIds.length > 0 ? calendarIds : (config.importBusyCalendars || []);
    const targetCalendarsSet = new Set<string>(manualCalendars);

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
    const isAuthenticated = gapi.client.getToken() !== null;

    if (!isAuthenticated) {
        targetCalendars = targetCalendars.filter(id => id !== 'primary');
        if (targetCalendars.length === 0) {
            if (!silent) console.log("Guest Sync: Nessun calendario pubblico. Salto sync.");
            return 0;
        }
    } else {
        if (targetCalendars.length === 0) {
            targetCalendars = ['primary'];
        }
    }

    const now = new Date();
    const nextMonth = new Date();
    nextMonth.setDate(nextMonth.getDate() + 30);

    try {
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
                if (e.status === 401 || e.status === 403) {
                     if (!silent) console.warn(`Impossibile leggere calendario ${calId} (Privato/No Auth)`);
                     hasReadErrors = true;
                } else if (e.status === 404) {
                    // Ignora
                } else {
                    console.warn(`Errore generico lettura calendario ${calId}:`, e);
                }
            }
        }

        if (allGoogleEvents.length === 0 && hasReadErrors) {
            return 0;
        }

        if (allGoogleEvents.length > 0 || (!hasReadErrors && targetCalendars.length > 0)) {
            const q = query(collection(db, BOOKING_COLLECTION), where("sportName", "==", "EXTERNAL_BUSY"));
            const snapshot = await getDocs(q);
            const deletePromises = snapshot.docs.map(d => deleteDoc(doc(db, BOOKING_COLLECTION, d.id)));
            await Promise.all(deletePromises);
        } else {
            return 0;
        }

        const addPromises = allGoogleEvents.map((ev: any) => {
            if (!ev.start.dateTime) return Promise.resolve(); 
            
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
            let targetCalendarId = defaultCalendarId;
            const sport = config.sports.find(s => s.id === booking.sportId);
            if (sport) {
                const location = sport.locations.find(l => l.id === booking.locationId);
                if (location && location.googleCalendarId) {
                    targetCalendarId = location.googleCalendarId;
                }
            }

            const event = {
                summary: `🎾 ${booking.sportName}: ${booking.customerName}`,
                location: booking.locationName,
                description: `Cliente: ${booking.customerName} (${booking.customerEmail || 'N/A'})\nTelefono: ${booking.customerPhone || 'N/A'}\nTipo: ${booking.lessonTypeName || 'Standard'}\nLivello: ${booking.skillLevel || 'N/A'}\nNote: ${booking.notes || 'Nessuna'}`,
                start: {
                    dateTime: booking.startTime, 
                },
                end: {
                    dateTime: new Date(new Date(booking.startTime).getTime() + booking.durationMinutes * 60000).toISOString(), 
                }
            };

            const response = await gapi.client.calendar.events.insert({
                calendarId: targetCalendarId,
                resource: event
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
