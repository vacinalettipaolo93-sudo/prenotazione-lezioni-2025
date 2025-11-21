
export enum UserRole {
  GUEST = 'GUEST',
  ADMIN = 'ADMIN'
}

// --- CONFIGURATION TYPES ---

export interface Sport {
  id: string;
  name: string;
  emoji: string; // Icona visiva
  description: string;
}

export interface LessonDuration {
  minutes: number;
  label: string;
}

export interface DailySchedule {
  isOpen: boolean;
  start: string; // Format "HH:mm" es "09:00"
  end: string;   // Format "HH:mm" es "22:00"
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

export interface Location {
  id: string;
  name: string;
  address: string;
  schedule: WeeklySchedule; // Orari specifici per sede
  slotInterval: 30 | 60;    // Intervallo specifico per sede
  googleCalendarId?: string; // ID del calendario esterno (es. Google Calendar)
}

export interface AppConfig {
  homeTitle: string;
  homeSubtitle: string;
  sports: Sport[];
  locations: Location[];
  durations: LessonDuration[];
  minBookingNoticeMinutes: number; // Tempo minimo di preavviso in minuti
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
  durationMinutes: number;
  date: string; // YYYY-MM-DD
  timeSlotId: string;
  startTime: string;
  customerName: string;
  customerEmail: string;
  skillLevel: 'Beginner' | 'Intermediate' | 'Advanced';
  notes?: string;
  aiLessonPlan?: string;
  targetCalendarId?: string; // ID del calendario dove è stata salvata la prenotazione
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
}
