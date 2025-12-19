
export enum UserRole {
  GUEST = 'GUEST',
  ADMIN = 'ADMIN'
}

// --- CONFIGURATION TYPES ---

export interface LessonDuration {
  minutes: number;
  label: string;
}

export interface DailySchedule {
  isOpen: boolean;
  start: string; // Format "HH:mm" es "09:00"
  end: string;   // Format "HH:mm" es "22:00"
  allowedLessonTypeIds?: string[]; // IDs of lesson types allowed on this day
}

export interface WeeklySchedule {
  monday: DailySchedule;
  tuesday: DailySchedule;
  wednesday: DailySchedule;
  thursday: DailySchedule;
  friday: DailySchedule;
  saturday: DailySchedule;
  sunday: DailySchedule;
}

// Location is now nested inside Sport
export interface SportLocation {
  id: string;
  name: string;
  address: string;
  googleCalendarId?: string; // ID del calendario specifico per questo sport in questa sede
  schedule: WeeklySchedule; // Orari standard settimanali
  scheduleExceptions?: Record<string, DailySchedule>; // ECCEZIONI: Key è "YYYY-MM-DD"
  slotInterval: 30 | 60;
}

export interface LessonType {
  id: string;
  name: string; // es. "Lezione Singola", "Doppio", "Partita"
  price?: number;
}

export interface Sport {
  id: string;
  name: string;
  emoji: string; // Icona visiva
  description: string;
  // Nested Configuration
  locations: SportLocation[];
  lessonTypes: LessonType[];
  durations: number[]; // Array of minutes allowed, e.g. [60, 90]
}

export interface AppConfig {
  homeTitle: string;
  homeSubtitle: string;
  sports: Sport[]; // All config is now here
  minBookingNoticeMinutes: number; // Tempo minimo di preavviso in minuti
  importBusyCalendars?: string[]; // Lista ID calendari da cui importare impegni (Global busy check)
  
  // Deprecated global fields (kept for type safety during migration if needed, but unused in new logic)
  locations?: any[]; 
  durations?: any[];
}

// --- BOOKING TYPES ---

export interface TimeSlot {
  id: string;
  startTime: string; // ISO string
  endTime: string; // ISO string
  isAvailable: boolean;
}

export interface Booking {
  id: string;
  sportId: string;
  sportName: string;
  
  locationId: string;
  locationName: string;
  
  lessonTypeId?: string;
  lessonTypeName?: string; // "Singola", "Doppia"
  
  durationMinutes: number;
  date: string; // YYYY-MM-DD
  timeSlotId: string;
  startTime: string;
  
  customerName: string;
  customerEmail: string;
  customerPhone?: string; // Nuovo campo telefono
  skillLevel: 'Beginner' | 'Intermediate' | 'Advanced';
  notes?: string;
  
  aiLessonPlan?: string;
  targetCalendarId?: string; // ID del calendario dove è stata salvata la prenotazione
  googleEventId?: string; // ID dell'evento creato su Google Calendar (se sincronizzato)
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO string
  end: string; // ISO string
  type: 'APP_BOOKING' | 'EXTERNAL_BUSY'; 
  description?: string;
}

export interface LessonPlanRequest {
  sport: string;
  skillLevel: string;
  durationMinutes: number;
  focusArea?: string;
  lessonType?: string;
}
