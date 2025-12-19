
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

export interface SportLocation {
  id: string;
  name: string;
  address: string;
  googleCalendarId?: string; 
  schedule: WeeklySchedule; 
  scheduleExceptions?: Record<string, DailySchedule>; 
  slotInterval: 30 | 60;
}

export interface LessonType {
  id: string;
  name: string; 
  price?: number;
}

export interface Sport {
  id: string;
  name: string;
  emoji: string; 
  description: string;
  locations: SportLocation[];
  lessonTypes: LessonType[];
  durations: number[]; 
}

export interface AppConfig {
  homeTitle: string;
  homeSubtitle: string;
  sports: Sport[]; 
  minBookingNoticeMinutes: number; 
  importBusyCalendars?: string[]; 
}

// --- BOOKING TYPES ---

export interface TimeSlot {
  id: string;
  startTime: string; 
  endTime: string; 
  isAvailable: boolean;
}

export interface Booking {
  id: string;
  sportId: string;
  sportName: string;
  
  locationId: string;
  locationName: string;
  
  lessonTypeId?: string;
  lessonTypeName?: string; 
  
  durationMinutes: number;
  date: string; 
  timeSlotId: string;
  startTime: string;
  
  customerName: string;
  customerEmail: string;
  customerPhone?: string; 
  skillLevel: 'Beginner' | 'Intermediate' | 'Advanced';
  notes?: string;
  
  aiLessonPlan?: string;
  targetCalendarId?: string; 
  googleEventId?: string; 
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string; 
  end: string; 
  type: 'APP_BOOKING' | 'EXTERNAL_BUSY' | 'PLAYTOMIC_BUSY'; 
  description?: string;
}

export interface LessonPlanRequest {
  sport: string;
  skillLevel: string;
  durationMinutes: number;
  focusArea?: string;
  lessonType?: string;
}
