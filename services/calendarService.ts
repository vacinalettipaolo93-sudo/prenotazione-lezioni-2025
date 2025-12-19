
import { TimeSlot, Booking, CalendarEvent, DailySchedule } from '../types';
import { getAppConfig } from './configService';
import { db } from './firebase';
import { collection, addDoc, onSnapshot, query, orderBy, where, getDocs, deleteDoc, doc, updateDoc, getDoc, writeBatch } from 'firebase/firestore';

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

export const initBookingListener = (callback: (bookings: Booking[]) => void) => {
    if (cachedBookings.length > 0) callback(cachedBookings);
    const q = query(collection(db, BOOKING_COLLECTION), orderBy('startTime', 'asc'));
    return onSnapshot(q, (snapshot) => {
        const loadedBookings: Booking[] = [];
        snapshot.forEach(doc => {
            loadedBookings.push({ id: doc.id, ...doc.data() } as Booking);
        });
        cachedBookings = loadedBookings;
        callback(loadedBookings);
    });
};

export const getBookings = (): Booking[] => cachedBookings;

export const deleteGoogleEvent = async (calendarId: string, eventId: string) => {
    const gapi = (window as any).gapi;
    if (!gapi || !gapi.client || gapi.client.getToken() === null) return;
    try {
        await gapi.client.calendar.events.delete({ calendarId, eventId });
    } catch (e) { console.warn(e); }
}

export const deleteBooking = async (bookingId: string): Promise<void> => {
    const docRef = doc(db, BOOKING_COLLECTION, bookingId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        const data = docSnap.data() as Booking;
        if (data.googleEventId && data.targetCalendarId) {
            await deleteGoogleEvent(data.targetCalendarId, data.googleEventId);
        }
    }
    await deleteDoc(docRef);
};

export const updateBooking = async (bookingId: string, updates: Partial<Booking>): Promise<void> => {
    await updateDoc(doc(db, BOOKING_COLLECTION, bookingId), updates);
};

export const getAllCalendarEvents = (): CalendarEvent[] => {
  return cachedBookings.map(b => ({
    id: b.id,
    title: b.sportName === 'EXTERNAL_BUSY' ? 'Occupato (Google)' : b.sportName === 'PLAYTOMIC_BUSY' ? 'Occupato (Playtomic)' : `${b.sportName}: ${b.customerName}`,
    start: b.startTime,
    end: new Date(new Date(b.startTime).getTime() + b.durationMinutes * 60 * 1000).toISOString(),
    type: (b.sportName === 'EXTERNAL_BUSY' ? 'EXTERNAL_BUSY' : b.sportName === 'PLAYTOMIC_BUSY' ? 'PLAYTOMIC_BUSY' : 'APP_BOOKING') as any,
    description: b.notes
  })).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
};

export const saveBooking = async (booking: Booking): Promise<void> => {
    const { id, ...bookingData } = booking; 
    await addDoc(collection(db, BOOKING_COLLECTION), bookingData);
};

// --- PLAYTOMIC CSV LOGIC ---

export const importPlaytomicCsv = async (csvContent: string, locationId: string): Promise<number> => {
    const lines = csvContent.split(/\r?\n/);
    if (lines.length < 2) return 0;

    const batch = writeBatch(db);
    let count = 0;

    // Puliamo i vecchi blocchi playtomic per questa sede per evitare duplicati
    const q = query(collection(db, BOOKING_COLLECTION), 
        where("sportName", "==", "PLAYTOMIC_BUSY"),
        where("locationId", "==", locationId)
    );
    const oldDocs = await getDocs(q);
    oldDocs.forEach(d => batch.delete(d.ref));

    // Il CSV di Playtomic solitamente ha un ordine come: Data, Ora Inizio, Ora Fine, ecc.
    // Prova a individuare le colonne giuste se i nomi variano
    for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(',').map(cell => cell.replace(/"/g, '').trim());
        if (row.length < 3) continue;

        try {
            // Assumiamo formato Playtomic Standard: 
            // 0: Data (YYYY-MM-DD), 1: Ora Inizio (HH:MM), 2: Ora Fine (HH:MM)
            const dateStr = row[0]; 
            const startTimeStr = row[1];
            const endTimeStr = row[2];

            const start = new Date(`${dateStr}T${startTimeStr}:00`);
            const end = new Date(`${dateStr}T${endTimeStr}:00`);

            if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;

            const duration = (end.getTime() - start.getTime()) / 60000;

            const busyBlock = {
                sportId: 'playtomic',
                sportName: 'PLAYTOMIC_BUSY',
                locationId: locationId,
                locationName: 'Playtomic CSV',
                durationMinutes: duration,
                date: dateStr,
                timeSlotId: `playtomic-csv-${i}`,
                startTime: start.toISOString(),
                customerName: 'Prenotazione Playtomic',
                customerEmail: '',
                skillLevel: 'Beginner'
            };

            const newDocRef = doc(collection(db, BOOKING_COLLECTION));
            batch.set(newDocRef, busyBlock);
            count++;
        } catch (e) {
            console.warn("Riga CSV non valida:", lines[i]);
        }
    }

    await batch.commit();
    return count;
};

// --- GOOGLE CALENDAR LOGIC ---

export const getAvailableSlots = (date: Date, durationMinutes: number, sportId: string, locationId: string, lessonTypeId?: string): TimeSlot[] => {
  const config = getAppConfig();
  const allEvents = getAllCalendarEvents(); 
  
  const sport = config.sports.find(s => s.id === sportId);
  if (!sport) return [];
  const location = sport.locations.find(l => l.id === locationId);
  if (!location) return [];

  const dateString = date.toISOString().split('T')[0];
  let daySchedule: DailySchedule | undefined = location.scheduleExceptions?.[dateString];

  if (!daySchedule) {
      const daysMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayName = daysMap[date.getDay()] as keyof typeof location.schedule;
      daySchedule = location.schedule[dayName];
  }

  if (!daySchedule || !daySchedule.isOpen) return [];
  if (lessonTypeId && daySchedule.allowedLessonTypeIds?.length) {
      if (!daySchedule.allowedLessonTypeIds.includes(lessonTypeId)) return [];
  }

  const [startH, startM] = daySchedule.start.split(':').map(Number);
  const [endH, endM] = daySchedule.end.split(':').map(Number);
  const dayStart = new Date(date); dayStart.setHours(startH, startM, 0, 0);
  const dayEnd = new Date(date); dayEnd.setHours(endH, endM, 0, 0);

  const slots: TimeSlot[] = [];
  const interval = location.slotInterval; 
  const minNoticeMinutes = Number(config.minBookingNoticeMinutes) || 0;
  const earliestAllowedTime = new Date(Date.now() + minNoticeMinutes * 60000);

  let currentSlotStart = new Date(dayStart);
  while (currentSlotStart < dayEnd) {
      const currentSlotEnd = new Date(currentSlotStart.getTime() + durationMinutes * 60000);
      if (currentSlotEnd > dayEnd) break; 

      const isBusy = allEvents.some(event => {
          // Se è un impegno Playtomic, lo consideriamo busy solo se è nella stessa sede
          const rawBooking = cachedBookings.find(b => b.id === event.id);
          if (rawBooking?.sportName === 'PLAYTOMIC_BUSY' && rawBooking.locationId !== locationId) {
              return false;
          }

          const eventStart = new Date(event.start).getTime();
          const eventEnd = new Date(event.end).getTime();
          const slotStartTime = currentSlotStart.getTime();
          const slotEndTime = currentSlotEnd.getTime();
          return (eventStart < slotEndTime && eventEnd > slotStartTime);
      });

      slots.push({
          id: `${dateString}-${locationId}-${currentSlotStart.getHours()}-${currentSlotStart.getMinutes()}`,
          startTime: currentSlotStart.toISOString(),
          endTime: currentSlotEnd.toISOString(),
          isAvailable: !isBusy && currentSlotStart >= earliestAllowedTime
      });
      currentSlotStart = new Date(currentSlotStart.getTime() + interval * 60000);
  }
  return slots;
};

export const initGoogleClient = async (): Promise<void> => {
    if (initPromise) return initPromise;
    initPromise = new Promise(async (resolve) => {
        const check = () => {
            if ((window as any).google && (window as any).gapi) {
                const gapi = (window as any).gapi;
                const google = (window as any).google;
                if (!gisInited) {
                    tokenClient = google.accounts.oauth2.initTokenClient({
                        client_id: CLIENT_ID, scope: SCOPES, callback: '',
                    });
                    gisInited = true;
                }
                if (!gapiInited) {
                    gapi.load('client', async () => {
                        await gapi.client.init({ apiKey: API_KEY, discoveryDocs: [DISCOVERY_DOC] });
                        gapiInited = true;
                        if (localStorage.getItem('courtmaster_gcal_token') === 'true') {
                            tokenClient.callback = () => resolve();
                            tokenClient.requestAccessToken({prompt: ''});
                        } else resolve();
                    });
                } else resolve();
            } else setTimeout(check, 100);
        };
        check();
    });
    return initPromise;
};

export const isCalendarConnected = () => localStorage.getItem('courtmaster_gcal_token') === 'true';

export const connectGoogleCalendar = async (): Promise<boolean> => {
  return new Promise((resolve, reject) => {
    tokenClient.callback = async (resp: any) => {
      if (resp.error) return reject(resp);
      localStorage.setItem('courtmaster_gcal_token', 'true');
      startAutoSync();
      resolve(true);
    };
    tokenClient.requestAccessToken({prompt: (window as any).gapi.client.getToken() === null ? 'consent' : ''});
  });
};

export const disconnectGoogleCalendar = () => {
  stopAutoSync();
  localStorage.removeItem('courtmaster_gcal_token');
};

export const listGoogleCalendars = async () => {
    const gapi = (window as any).gapi;
    if (!gapi?.client?.getToken()) return [];
    try {
        const response = await gapi.client.calendar.calendarList.list();
        return response.result.items.map((item: any) => ({ id: item.id, summary: item.summary, primary: item.primary }));
    } catch (e) { return []; }
}

export const startAutoSync = () => {
    if (autoSyncInterval) clearInterval(autoSyncInterval);
    const syncAll = () => {
        syncGoogleEventsToFirebase(undefined, true);
    };
    syncAll();
    autoSyncInterval = setInterval(syncAll, 5 * 60 * 1000); 
};

export const stopAutoSync = () => { if (autoSyncInterval) { clearInterval(autoSyncInterval); autoSyncInterval = null; } }

export const syncGoogleEventsToFirebase = async (calendarIds: string[] = [], silent = false) => {
    const gapi = (window as any).gapi;
    if (!gapi?.client) return 0;
    const config = getAppConfig();
    let targetCalendars = calendarIds.length ? calendarIds : (config.importBusyCalendars || []);
    if (gapi.client.getToken()) {
        if (!targetCalendars.length) targetCalendars = ['primary'];
    } else {
        targetCalendars = targetCalendars.filter(id => id !== 'primary');
    }
    if (!targetCalendars.length) return 0;

    const now = new Date();
    const nextMonth = new Date(); nextMonth.setDate(nextMonth.getDate() + 30);

    try {
        let allGoogleEvents: any[] = [];
        for (const calId of targetCalendars) {
            try {
                const res = await gapi.client.calendar.events.list({
                    'calendarId': calId, 'timeMin': now.toISOString(), 'timeMax': nextMonth.toISOString(),
                    'showDeleted': false, 'singleEvents': true, 'orderBy': 'startTime'
                });
                if (res.result.items) allGoogleEvents.push(...res.result.items);
            } catch (e) {}
        }

        const q = query(collection(db, BOOKING_COLLECTION), where("sportName", "==", "EXTERNAL_BUSY"));
        const snapshot = await getDocs(q);
        const batch = writeBatch(db);
        snapshot.docs.forEach(d => batch.delete(d.ref));

        allGoogleEvents.forEach(ev => {
            if (!ev.start.dateTime) return;
            const start = new Date(ev.start.dateTime);
            const end = new Date(ev.end.dateTime);
            const busyBlock = {
                sportId: 'external', sportName: 'EXTERNAL_BUSY', locationId: 'all', locationName: 'Google Calendar',
                durationMinutes: (end.getTime() - start.getTime()) / 60000, date: start.toISOString().split('T')[0],
                timeSlotId: 'external', startTime: start.toISOString(), customerName: ev.summary || 'Impegno Google',
                customerEmail: '', skillLevel: 'Beginner'
            };
            batch.set(doc(collection(db, BOOKING_COLLECTION)), busyBlock);
        });
        await batch.commit();
        return allGoogleEvents.length;
    } catch (error) { return 0; }
};

export const exportBookingsToGoogle = async (defaultCalendarId: string = 'primary'): Promise<number> => {
    const gapi = (window as any).gapi;
    if (!gapi?.client?.getToken()) return 0;
    const config = getAppConfig();
    const unsynced = cachedBookings.filter(b => !b.googleEventId && !['EXTERNAL_BUSY', 'PLAYTOMIC_BUSY'].includes(b.sportName) && new Date(b.startTime) > new Date());
    let successCount = 0;
    for (const booking of unsynced) {
        try {
            let calId = defaultCalendarId;
            const loc = config.sports.find(s => s.id === booking.sportId)?.locations.find(l => l.id === booking.locationId);
            if (loc?.googleCalendarId) calId = loc.googleCalendarId;

            const res = await gapi.client.calendar.events.insert({
                'calendarId': calId,
                'resource': {
                    'summary': `🎾 ${booking.sportName}: ${booking.customerName}`,
                    'location': booking.locationName,
                    'description': `Cliente: ${booking.customerName}\nTel: ${booking.customerPhone}\nNote: ${booking.notes}`,
                    'start': { 'dateTime': booking.startTime },
                    'end': { 'dateTime': new Date(new Date(booking.startTime).getTime() + booking.durationMinutes * 60000).toISOString() }
                }
            });
            if (res.result?.id) {
                await updateDoc(doc(db, BOOKING_COLLECTION, booking.id), { googleEventId: res.result.id, targetCalendarId: calId });
                successCount++;
            }
        } catch (e) {}
    }
    return successCount;
};
