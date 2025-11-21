
import { TimeSlot, Booking, CalendarEvent } from '../types';
import { getAppConfig } from './configService';
import { db } from './firebase';
import { collection, addDoc, onSnapshot, query, orderBy, where, getDocs, deleteDoc, doc, updateDoc } from 'firebase/firestore';

// --- CONFIGURAZIONE GOOGLE CALENDAR ---
// SOSTITUISCI QUESTI VALORI CON QUELLI PRESI DA GOOGLE CLOUD CONSOLE
const CLIENT_ID = '747839079234-9kb2r0iviapcqci554cfheaksqe3lm29.apps.googleusercontent.com'; 
const API_KEY = 'AIzaSyAv_qusWIgR7g2C1w1MeLyCNQNghZg9sWA'; 

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/calendar.events'; // Scope aumentato per poter scrivere

const BOOKING_COLLECTION = 'bookings';

// Cache locale mantenuta aggiornata da Firebase
let cachedBookings: Booking[] = [];
let bookingListeners: ((bookings: Booking[]) => void)[] = [];

// Global GAPI objects
let tokenClient: any;
let gapiInited = false;
let gisInited = false;

// --- REAL-TIME SUBSCRIPTION ---

export const initBookingListener = (callback?: (bookings: Booking[]) => void) => {
    if (callback) bookingListeners.push(callback);

    // Ascoltiamo sia le prenotazioni dell'app che gli eventi esterni sincronizzati
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
  // Convertiamo le prenotazioni di Firebase in eventi per il calendario
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

export const getAvailableSlots = (date: Date, durationMinutes: number, locationId: string): TimeSlot[] => {
  const config = getAppConfig();
  const allEvents = getAllCalendarEvents(); 
  
  const location = config.locations.find(l => l.id === locationId);
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

      // Controllo sovrapposizioni con eventi (sia app che google synced)
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

export const initGoogleClient = async (): Promise<void> => {
    return new Promise((resolve) => {
        const gapi = (window as any).gapi;
        const google = (window as any).google;

        if (!gapi || !google) {
            console.error("Google Scripts not loaded");
            return;
        }

        // Init GAPI for API calls
        gapi.load('client', async () => {
            try {
              await gapi.client.init({
                  apiKey: API_KEY,
                  discoveryDocs: [DISCOVERY_DOC],
              });
              gapiInited = true;
            } catch (e) {
              console.error("Errore GAPI Init (probabilmente API KEY errata):", e);
            }
            
            if (gisInited) resolve();
        });

        // Init GIS for Auth
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: '', // Defined at request time
        });
        gisInited = true;
        if (gapiInited) resolve();
    });
};

export const isCalendarConnected = (): boolean => {
  return localStorage.getItem('courtmaster_gcal_token') === 'true';
};

export const connectGoogleCalendar = async (): Promise<boolean> => {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
        alert("Configurazione Google incompleta. Ricarica la pagina.");
        reject(false);
        return;
    }

    tokenClient.callback = async (resp: any) => {
      if (resp.error) {
        reject(resp);
        return;
      }
      
      // CRUCIALE: Impostiamo il token per le chiamate API successive
      const gapi = (window as any).gapi;
      if (gapi && gapi.client) {
          gapi.client.setToken(resp);
      }

      localStorage.setItem('courtmaster_gcal_token', 'true');
      resolve(true);
    };

    if ((window as any).gapi.client.getToken() === null) {
      // Prompt the user to select a Google Account and ask for consent to share their data
      tokenClient.requestAccessToken({prompt: 'consent'});
    } else {
      // Skip display of account chooser and consent dialog for an existing session.
      tokenClient.requestAccessToken({prompt: ''});
    }
  });
};

export const disconnectGoogleCalendar = () => {
  const google = (window as any).google;
  const gapi = (window as any).gapi;
  
  if(google) {
      try {
        google.accounts.oauth2.revoke(localStorage.getItem('courtmaster_gcal_token'), () => {console.log('Revoked')});
      } catch (e) {
        console.log("Errore revoca token (potrebbe essere già scaduto):", e);
      }
  }
  
  if (gapi && gapi.client) {
      gapi.client.setToken(null);
  }

  localStorage.removeItem('courtmaster_gcal_token');
};

/**
 * Scarica gli eventi da Google Calendar e li salva su Firebase come "EXTERNAL_BUSY".
 */
export const syncGoogleEventsToFirebase = async (calendarId: string = 'primary') => {
    const gapi = (window as any).gapi;
    if (!gapi || !gapi.client) {
        throw new Error("Google API non inizializzate");
    }
    
    if (gapi.client.getToken() === null) {
        throw new Error("Token scaduto o mancante. Riconnetti il calendario.");
    }

    const now = new Date();
    const nextMonth = new Date();
    nextMonth.setDate(nextMonth.getDate() + 30);

    try {
        const response = await gapi.client.calendar.events.list({
            'calendarId': calendarId,
            'timeMin': now.toISOString(),
            'timeMax': nextMonth.toISOString(),
            'showDeleted': false,
            'singleEvents': true,
            'orderBy': 'startTime'
        });

        const googleEvents = response.result.items;

        const q = query(collection(db, BOOKING_COLLECTION), where("sportName", "==", "EXTERNAL_BUSY"));
        const snapshot = await getDocs(q);
        const deletePromises = snapshot.docs.map(d => deleteDoc(doc(db, BOOKING_COLLECTION, d.id)));
        await Promise.all(deletePromises);

        const addPromises = googleEvents.map((ev: any) => {
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
                customerName: 'Google Event',
                customerEmail: '',
                skillLevel: 'Beginner'
            };
            
            return addDoc(collection(db, BOOKING_COLLECTION), busyBlock);
        });

        await Promise.all(addPromises);
        return googleEvents.length;

    } catch (error) {
        console.error("Errore Sync Google:", error);
        throw error;
    }
};

/**
 * Prende tutte le prenotazioni da Firebase che NON hanno ancora un 'googleEventId'
 * e le crea sul calendario Google dell'istruttore.
 */
export const exportBookingsToGoogle = async (defaultCalendarId: string = 'primary'): Promise<number> => {
    const gapi = (window as any).gapi;
    if (!gapi || !gapi.client || gapi.client.getToken() === null) {
        throw new Error("Devi connettere il calendario prima di esportare.");
    }

    const config = getAppConfig();
    
    // 1. Trova prenotazioni non sincronizzate (escludendo i blocchi EXTERNAL_BUSY)
    const unsyncedBookings = cachedBookings.filter(b => 
        !b.googleEventId && 
        b.sportName !== 'EXTERNAL_BUSY' && 
        new Date(b.startTime) > new Date() // Solo eventi futuri
    );

    let successCount = 0;

    for (const booking of unsyncedBookings) {
        try {
            // Determina il calendario target: o quello della location specifica o 'primary'
            let targetCalendarId = defaultCalendarId;
            const location = config.locations.find(l => l.id === booking.locationId);
            if (location && location.googleCalendarId) {
                targetCalendarId = location.googleCalendarId;
            }

            const event = {
                'summary': `🎾 Lezione ${booking.sportName}: ${booking.customerName}`,
                'location': booking.locationName,
                'description': `Cliente: ${booking.customerName} (${booking.customerEmail})\nLivello: ${booking.skillLevel}\nNote: ${booking.notes || 'Nessuna'}\n\nPiano AI: ${booking.aiLessonPlan?.substring(0, 100)}...`,
                'start': {
                    'dateTime': booking.startTime, 
                },
                'end': {
                    'dateTime': new Date(new Date(booking.startTime).getTime() + booking.durationMinutes * 60000).toISOString(), 
                }
            };

            // Chiamata API a Google
            const response = await gapi.client.calendar.events.insert({
                'calendarId': targetCalendarId,
                'resource': event
            });

            if (response.result && response.result.id) {
                // Aggiorna il documento Firebase con l'ID dell'evento Google per non duplicarlo in futuro
                const bookingRef = doc(db, BOOKING_COLLECTION, booking.id);
                await updateDoc(bookingRef, { googleEventId: response.result.id });
                successCount++;
            }

        } catch (error) {
            console.error(`Errore export prenotazione ${booking.customerName}:`, error);
            // Continua con la prossima, non bloccare tutto
        }
    }

    return successCount;
};
