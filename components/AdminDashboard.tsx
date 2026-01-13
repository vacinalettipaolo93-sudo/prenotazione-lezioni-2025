import React, { useState, useEffect, useMemo } from 'react';
import {
  CalendarEvent,
  AppConfig,
  WeeklySchedule,
  SportLocation,
  Sport,
  LessonType,
  DailySchedule,
  Booking
} from '../types';
import {
  getAllCalendarEvents,
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  isCalendarConnected,
  initGoogleClient,
  syncGoogleEventsToFirebase,
  exportBookingsToGoogle,
  listGoogleCalendars
} from '../services/calendarService';
import {
  getAppConfig,
  addSport,
  updateSport,
  removeSport,
  addSportLocation,
  updateSportLocation,
  removeSportLocation,
  addSportLessonType,
  removeSportLessonType,
  addSportDuration,
  removeSportDuration,
  initConfigListener,
  initBookingListener,
  updateImportBusyCalendars,
  updateMultipleLocationsExceptions,
  updateLocationException,
  updateHomeConfig,
  updateMinBookingNotice,
  deleteBooking,
  updateBooking
} from '../services/configService';
import { logout } from '../services/authService';
import Button from './Button';

interface AdminDashboardProps {
  onLogout: () => void;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onLogout }) => {
  const [activeTab, setActiveTab] = useState<'calendar' | 'config' | 'schedule' | 'home' | 'bookings'>('calendar');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [rawBookings, setRawBookings] = useState<Booking[]>([]);
  const [isConnected, setIsConnected] = useState<boolean>(isCalendarConnected());
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [config, setConfig] = useState<AppConfig>(getAppConfig());

  // Calendar State
  const [userCalendars, setUserCalendars] = useState<{ id: string; summary: string; primary?: boolean }[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);
  const [loadingCalendars, setLoadingCalendars] = useState(false);

  const [expandedSportId, setExpandedSportId] = useState<string | null>(null);
  const [newSportName, setNewSportName] = useState('');
  const [newLocName, setNewLocName] = useState('');
  const [newLocAddr, setNewLocAddr] = useState('');
  const [newLessonType, setNewLessonType] = useState('');
  const [newDuration, setNewDuration] = useState('60');

  const [editingSportId, setEditingSportId] = useState<string | null>(null);
  const [tempSport, setTempSport] = useState<Partial<Sport>>({});

  const [homeTitle, setHomeTitle] = useState('');
  const [homeSubtitle, setHomeSubtitle] = useState('');
  const [noticeHours, setNoticeHours] = useState<number>(0);

  const [selectedScheduleSportId, setSelectedScheduleSportId] = useState<string>('');
  const [selectedScheduleLocId, setSelectedScheduleLocId] = useState<string>('');
  const [editingSchedule, setEditingSchedule] = useState<WeeklySchedule | null>(null);
  const [editingSlotInterval, setEditingSlotInterval] = useState<30 | 60>(60);

  // Exception Management State
  const [exceptionDate, setExceptionDate] = useState<string>('');
  const [exceptionData, setExceptionData] = useState<DailySchedule>({
    isOpen: true,
    start: '09:00',
    end: '22:00',
    allowedLessonTypeIds: []
  });
  const [applyToAllLocs, setApplyToAllLocs] = useState(false);

  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      await initGoogleClient();
      setIsConnected(isCalendarConnected());
      if (isCalendarConnected()) {
        fetchUserCalendars();
      }
    };
    init();

    const unsubConfig = initConfigListener((newConfig: AppConfig) => {
      setConfig(newConfig);
      setHomeTitle(newConfig.homeTitle);
      setHomeSubtitle(newConfig.homeSubtitle);
      setNoticeHours((newConfig.minBookingNoticeMinutes || 0) / 60);
      if (newConfig.importBusyCalendars) {
        setSelectedCalendarIds(newConfig.importBusyCalendars);
      }
    });

    const unsubBookings = initBookingListener((newBookings: Booking[]) => {
      setEvents(getAllCalendarEvents());
      setRawBookings(
        newBookings
          .filter((b) => b.sportName !== 'EXTERNAL_BUSY')
          .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      );
    });

    return () => {
      unsubConfig();
      unsubBookings();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isConnected && userCalendars.length === 0) {
      fetchUserCalendars();
    }
  }, [isConnected, userCalendars.length]);

  useEffect(() => {
    if (config.sports.length > 0 && !selectedScheduleSportId) {
      const firstSport = config.sports[0];
      setSelectedScheduleSportId(firstSport.id);
      if (firstSport.locations.length > 0) {
        setSelectedScheduleLocId(firstSport.locations[0].id);
      }
    }
  }, [config.sports, selectedScheduleSportId]);

  useEffect(() => {
    if (selectedScheduleSportId && selectedScheduleLocId) {
      const sport = config.sports.find((s) => s.id === selectedScheduleSportId);
      const loc = sport?.locations.find((l) => l.id === selectedScheduleLocId);
      if (loc) {
        setEditingSchedule(loc.schedule);
        setEditingSlotInterval(loc.slotInterval);
      } else {
        setEditingSchedule(null);
      }
    }
  }, [selectedScheduleSportId, selectedScheduleLocId, config.sports]);

  // Aggregated Exceptions for the selected sport, filtering out past dates
  const sportWideExceptions = useMemo<Record<string, Record<string, DailySchedule>>>(() => {
    if (!selectedScheduleSportId) return {};
    const sport = config.sports.find((s) => s.id === selectedScheduleSportId);
    if (!sport) return {};

    // Get today's date string for filtering
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayString = today.toISOString().split('T')[0];

    const aggregated: Record<string, Record<string, DailySchedule>> = {};
    sport.locations.forEach((loc) => {
      if (loc.scheduleExceptions) {
        (Object.entries(loc.scheduleExceptions) as [string, DailySchedule][]).forEach(([date, schedule]) => {
          // FILTER: Only show exceptions from today onwards
          if (date >= todayString) {
            if (!aggregated[date]) {
              aggregated[date] = {};
            }
            aggregated[date][loc.id] = schedule;
          }
        });
      }
    });
    return aggregated;
  }, [selectedScheduleSportId, config.sports]);

  const fetchUserCalendars = async () => {
    setLoadingCalendars(true);
    try {
      const cals = await listGoogleCalendars();
      setUserCalendars(cals);
    } catch (e: any) {
      console.error('Could not list calendars', e);
      if (e.status === 401) setIsConnected(false);
    } finally {
      setLoadingCalendars(false);
    }
  };

  const handleConnectCalendar = async () => {
    setIsConnecting(true);
    try {
      await connectGoogleCalendar();
      setIsConnected(true);
      fetchUserCalendars();
    } catch (e: any) {
      if (e && e.error === 'access_denied') {
        alert('ACCESSO NEGATO: Aggiungi la tua email ai Test Users in Google Cloud Console.');
      } else {
        alert('Errore connessione Google Calendar.');
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSyncNow = async () => {
    if (!isConnected) return;
    setIsSyncing(true);
    try {
      const calendarsToSync = config.importBusyCalendars || selectedCalendarIds;
      const count = await syncGoogleEventsToFirebase(calendarsToSync);
      alert(`Sincronizzazione completata! ${count} impegni importati.`);
    } catch (e) {
      alert('Errore durante la sincronizzazione.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleExportToGoogle = async () => {
    if (!isConnected) return;
    setIsExporting(true);
    try {
      const count = await exportBookingsToGoogle('primary');
      alert(`Successo! ${count} nuove prenotazioni esportate.`);
    } catch (e) {
      alert("Errore durante l'esportazione.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleDeleteBooking = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (window.confirm('Sei sicuro di voler eliminare questa prenotazione?')) {
      setDeletingId(id);
      try {
        await deleteBooking(id);
      } catch (err) {
        alert("Errore durante l'eliminazione");
      } finally {
        setDeletingId(null);
      }
    }
  };

  const handleOpenEditBooking = (e: React.MouseEvent, booking: Booking) => {
    e.stopPropagation();
    setEditingBooking(booking);
    const d = new Date(booking.startTime);
    setEditDate(d.toISOString().split('T')[0]);
    setEditTime(`${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`);
  };

  const handleSaveBookingEdit = async () => {
    if (!editingBooking || !editDate || !editTime) return;
    try {
      const newStart = new Date(`${editDate}T${editTime}`);
      const isoStartTime = newStart.toISOString();
      await updateBooking(editingBooking.id, {
        customerName: editingBooking.customerName,
        customerEmail: editingBooking.customerEmail,
        customerPhone: editingBooking.customerPhone,
        notes: editingBooking.notes,
        startTime: isoStartTime,
        date: editDate
      });
      setEditingBooking(null);
    } catch (e) {
      alert("Errore durante l'aggiornamento.");
    }
  };

  const handleAddSport = () => {
    if (!newSportName) return;
    addSport(newSportName);
    setNewSportName('');
  };

  const startEditSport = (sport: Sport) => {
    setEditingSportId(sport.id);
    setTempSport({ ...sport });
  };

  const saveEditSport = () => {
    if (editingSportId && tempSport.name) {
      updateSport(editingSportId, tempSport);
      setEditingSportId(null);
    }
  };

  const handleAddLocation = (sportId: string) => {
    if (!newLocName) return;
    addSportLocation(sportId, newLocName, newLocAddr);
    setNewLocName('');
    setNewLocAddr('');
  };

  const handleUpdateLocation = (sportId: string, locId: string, updates: Partial<SportLocation>) => {
    updateSportLocation(sportId, locId, updates);
  };

  const handleUpdateLessonType = (sportId: string, typeId: string, newName: string) => {
    const sport = config.sports.find((s) => s.id === sportId);
    if (sport) {
      const newTypes = sport.lessonTypes.map((t) => (t.id === typeId ? { ...t, name: newName } : t));
      updateSport(sportId, { lessonTypes: newTypes });
    }
  };

  const handleAddLessonType = (sportId: string) => {
    if (!newLessonType) return;
    addSportLessonType(sportId, newLessonType);
    setNewLessonType('');
  };

  const handleAddDuration = (sportId: string) => {
    const mins = parseInt(newDuration, 10);
    if (mins > 0) {
      addSportDuration(sportId, mins);
    }
  };

  const handleSaveSchedule = () => {
    if (!selectedScheduleSportId || !selectedScheduleLocId || !editingSchedule) return;
    updateSportLocation(selectedScheduleSportId, selectedScheduleLocId, {
      schedule: editingSchedule,
      slotInterval: editingSlotInterval
    });
    alert('Orari aggiornati!');
  };

  const handleScheduleChange = (day: keyof WeeklySchedule, field: 'start' | 'end' | 'isOpen', value: any) => {
    if (!editingSchedule) return;
    setEditingSchedule((prev) => {
      if (!prev) return null;
      return { ...prev, [day]: { ...prev[day], [field]: value } };
    });
  };

  const handleLessonTypeToggle = (day: keyof WeeklySchedule, typeId: string) => {
    if (!editingSchedule) return;
    setEditingSchedule((prev) => {
      if (!prev) return null;
      const currentTypes = prev[day].allowedLessonTypeIds || [];
      const newTypes = currentTypes.includes(typeId) ? currentTypes.filter((id) => id !== typeId) : [...currentTypes, typeId];
      return { ...prev, [day]: { ...prev[day], allowedLessonTypeIds: newTypes } };
    });
  };

  // Helpers to support multiple periods per day without touching existing backend schema:
  // If a day has no 'periods' we fallback to start/end (retrocompat)
  const ensurePeriods = (dayData: DailySchedule): DailySchedule & { periods?: { start: string; end: string }[] } => {
    const anyDay: any = dayData as any;
    if (anyDay.periods && Array.isArray(anyDay.periods) && anyDay.periods.length > 0) {
      return dayData as any;
    }
    if (dayData.start && dayData.end) {
      return { ...dayData, periods: [{ start: dayData.start, end: dayData.end }] } as any;
    }
    return { ...dayData, periods: [] } as any;
  };

  const handleAddPeriod = (day: keyof WeeklySchedule) => {
    if (!editingSchedule) return;
    setEditingSchedule((prev) => {
      if (!prev) return prev;
      const copy: any = { ...prev };
      const d = ensurePeriods(copy[day]);
      const periods = [...(d.periods || []), { start: '08:00', end: '12:00' }];
      copy[day] = { ...d, isOpen: true, periods };
      return copy;
    });
  };

  const handleRemovePeriod = (day: keyof WeeklySchedule, idx: number) => {
    if (!editingSchedule) return;
    setEditingSchedule((prev) => {
      if (!prev) return prev;
      const copy: any = { ...prev };
      const d = ensurePeriods(copy[day]);
      const periods = (d.periods || []).filter((_: any, i: number) => i !== idx);
      copy[day] = { ...d, periods };
      return copy;
    });
  };

  const handlePeriodChange = (day: keyof WeeklySchedule, idx: number, field: 'start' | 'end', value: string) => {
    if (!editingSchedule) return;
    setEditingSchedule((prev) => {
      if (!prev) return prev;
      const copy: any = { ...prev };
      const d = ensurePeriods(copy[day]);
      const periods = (d.periods || []).map((p: any, i: number) => (i === idx ? { ...p, [field]: value } : p));
      copy[day] = { ...d, periods };
      return copy;
    });
  };

  const handleSaveException = () => {
    if (!selectedScheduleSportId || !exceptionDate) return;

    const sport = config.sports.find((s) => s.id === selectedScheduleSportId);
    if (!sport) return;

    if (applyToAllLocs) {
      const locIds = sport.locations.map((l) => l.id);
      updateMultipleLocationsExceptions(selectedScheduleSportId, locIds, exceptionDate, exceptionData);
      alert(`Eccezione applicata a tutte le sedi di ${sport.name}`);
    } else {
      if (!selectedScheduleLocId) {
        alert("Seleziona una sede o attiva 'Applica a tutte le sedi'");
        return;
      }
      updateLocationException(selectedScheduleSportId, selectedScheduleLocId, exceptionDate, exceptionData);
      alert('Eccezione salvata per la sede selezionata.');
    }
    setExceptionDate('');
  };

  const handleDeleteException = (date: string, locIds: string[]) => {
    if (!selectedScheduleSportId) return;
    const msg = locIds.length > 1 ? `Rimuovere questa eccezione da TUTTE le sedi interessate (${locIds.length})?` : `Rimuovere questa eccezione per questa sede?`;

    if (window.confirm(msg)) {
      if (locIds.length > 1) {
        updateMultipleLocationsExceptions(selectedScheduleSportId, locIds, date, null);
      } else {
        updateLocationException(selectedScheduleSportId, locIds[0], date, null);
      }
    }
  };

  const handleUpdateHome = () => {
    updateHomeConfig(homeTitle, homeSubtitle);
    alert('Home aggiornata!');
  };

  const handleUpdateNotice = () => {
    updateMinBookingNotice(noticeHours * 60);
    alert('Preavviso aggiornato!');
  };

  const handleLogout = () => {
    logout();
    onLogout();
  };

  const dayLabels: Record<string, string> = {
    monday: 'Lunedì',
    tuesday: 'Martedì',
    wednesday: 'Mercoledì',
    thursday: 'Giovedì',
    friday: 'Venerdì',
    saturday: 'Sabato',
    sunday: 'Domenica'
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 relative">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-end mb-10 border-b border-slate-800 pb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Dashboard Gestione</h1>
          <p className="text-slate-400 mt-1">Pannello di controllo istruttore</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-slate-800 p-1 rounded-xl border border-slate-700 overflow-x-auto max-w-[100vw]">
            <button
              onClick={() => setActiveTab('calendar')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'calendar' ? 'bg-slate-700 text-white shadow' : 'bg-slate-900/50 text-slate-300 border-slate-700 hover:border-slate-500'}`}
            >
              Calendario
            </button>

            <button
              onClick={() => {
                setActiveTab('bookings');
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'bookings' ? 'bg-slate-700 text-white shadow' : 'bg-slate-900/50 text-slate-300 border-slate-700 hover:border-slate-500'}`}
            >
              Prenotazioni
            </button>

            <button
              onClick={() => setActiveTab('config')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'config' ? 'bg-slate-700 text-white shadow' : 'bg-slate-900/50 text-slate-300 border-slate-700 hover:border-slate-500'}`}
            >
              Config
            </button>

            <button
              onClick={() => setActiveTab('schedule')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'schedule' ? 'bg-slate-700 text-white shadow' : 'bg-slate-900/50 text-slate-300 border-slate-700 hover:border-slate-500'}`}
            >
              Orari
            </button>

            <button
              onClick={() => setActiveTab('home')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'home' ? 'bg-slate-700 text-white shadow' : 'bg-slate-900/50 text-slate-300 border-slate-700 hover:border-slate-500'}`}
            >
              Home
            </button>
          </div>
          <Button variant="outline" onClick={handleLogout} className="ml-2 border-red-900/50 text-red-400 hover:bg-red-900/20 hover:border-red-500/50">
            Esci
          </Button>
        </div>
      </div>

      {activeTab === 'calendar' && (
        <div className="space-y-8 animate-in fade-in">
          <div className={`p-6 rounded-xl border ${isConnected ? 'bg-emerald-900/10 border-emerald-500/30' : 'bg-slate-800 border-slate-700'}`}>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isConnected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-500'}`}>📅</div>
                <div>
                  <h3 className="font-bold text-lg text-white">Google Calendar</h3>
                  <p className="text-sm text-slate-400 flex items-center gap-2">
                    {isConnected ? 'Connesso' : 'Disconnesso'}
                    {isConnected && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 animate-pulse">
                        Auto-Sync Attivo
                      </span>
                    )}
                  </p>
                </div>
              </div>
              {!isConnected ? (
                <Button onClick={handleConnectCalendar} isLoading={isConnecting}>
                  Connetti
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button onClick={handleSyncNow} isLoading={isSyncing} variant="secondary">
                    Sync Forzato
                  </Button>
                  <Button onClick={handleExportToGoogle} isLoading={isExporting} variant="primary">
                    Esporta Nuovi
                  </Button>
                </div>
              )}
            </div>
          </div>

          {isConnected && (
            <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-white">Calendari "Occupati" (Import)</h3>
                <button onClick={fetchUserCalendars} disabled={loadingCalendars} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
                  <svg className={`w-4 h-4 ${loadingCalendars ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v6h6M20 20v-6h-6" />
                  </svg>
                  Aggiorna Lista
                </button>
              </div>

              {loadingCalendars ? (
                <p className="text-slate-400">Caricamento calendari...</p>
              ) : userCalendars.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-h-40 overflow-y-auto">
                  {userCalendars.map((cal) => (
                    <label key={cal.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${config.importBusyCalendars?.includes(cal.id) ? 'bg-indigo-900/10 border-indigo-500/30' : 'bg-slate-900/20 border-slate-700'}`}>
                      <input
                        type="checkbox"
                        checked={config.importBusyCalendars?.includes(cal.id) || false}
                        onChange={() => {
                          const current = config.importBusyCalendars || [];
                          const next = current.includes(cal.id) ? current.filter((id) => id !== cal.id) : [...current, cal.id];
                          updateImportBusyCalendars(next);
                        }}
                        className="rounded border-slate-600 text-indigo-600 focus:ring-indigo-500 bg-slate-800"
                      />
                      <div className="overflow-hidden">
                        <div className="font-medium text-sm text-white truncate">{cal.summary}</div>
                      </div>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="text-center py-4 bg-slate-900/30 rounded-lg border border-slate-800">
                  <p className="text-slate-400 text-sm mb-2">Nessun calendario trovato o sessione scaduta.</p>
                  <Button onClick={handleConnectCalendar} variant="ghost" className="text-xs">
                    Riconnetti Account
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'bookings' && (
        <div className="animate-in fade-in space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold text-white">Elenco Prenotazioni</h2>
          </div>
          {rawBookings.length === 0 ? (
            <div className="text-center py-20 bg-slate-800/50 rounded-xl border border-slate-700 text-slate-500">Nessuna prenotazione trovata.</div>
          ) : (
            <div className="space-y-4">
              {rawBookings.map((booking) => {
                const isPast = new Date(booking.startTime) < new Date();
                return (
                  <div key={booking.id} className={`p-4 rounded-xl border flex flex-col md:flex-row gap-4 justify-between items-start md:items-center ${isPast ? 'bg-slate-900 border-slate-800' : 'bg-slate-800/40 border-slate-700'}`}>
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <span className="font-bold text-lg text-white">{new Date(booking.startTime).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}</span>
                        <span className="bg-slate-700 text-slate-200 px-2 py-0.5 rounded text-sm font-mono">
                          {new Date(booking.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {isPast && <span className="text-xs bg-slate-800 text-slate-500 px-2 py-0.5 rounded border border-slate-700">PASSATA</span>}
                      </div>
                      <div className="text-slate-300 font-medium">{booking.sportName} - {booking.locationName}</div>
                      <div className="text-sm text-slate-400 mt-1">
                        <span className="font-bold text-indigo-300">{booking.customerName}</span> • {booking.customerPhone || 'No Tel'} • {booking.customerEmail}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 w-full md:w-auto min-w-[120px]">
                      <span className="text-xs bg-slate-900 px-2 py-1 rounded text-slate-400 border border-slate-700 w-full text-center">{booking.lessonTypeName}</span>
                      <div className="flex gap-2 w-full">
                        <button onClick={(e) => handleOpenEditBooking(e, booking)} className="flex-1 text-slate-300 hover:text-white text-xs border border-slate-600 hover:bg-slate-700/40 rounded py-2">
                          Modifica
                        </button>
                        <button onClick={(e) => handleDeleteBooking(e, booking.id)} disabled={deletingId === booking.id} className="flex-1 text-red-400 hover:text-red-300 text-xs border border-red-500/30 rounded py-2">
                          {deletingId === booking.id ? '...' : 'Elimina'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODAL MODIFICA PRENOTAZIONE */}
      {editingBooking && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-lg p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
            <h3 className="text-xl font-bold text-white mb-4">Modifica Prenotazione</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 bg-slate-900/50 p-3 rounded-lg border border-slate-700/50 mb-2">
                <div>
                  <label className="text-xs text-slate-400 uppercase font-bold">Data</label>
                  <input type="date" className="w-full bg-slate-800 border border-slate-600 rounded-lg p-2 text-white mt-1" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-slate-400 uppercase font-bold">Ora</label>
                  <input type="time" className="w-full bg-slate-800 border border-slate-600 rounded-lg p-2 text-white mt-1" value={editTime} onChange={(e) => setEditTime(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 uppercase font-bold">Nome Cliente</label>
                <input className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white mt-1" value={editingBooking.customerName} onChange={(e) => setEditingBooking({ ...editingBooking, customerName: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-3 mt-6 pt-4 border-t border-slate-700">
              <Button variant="ghost" onClick={() => setEditingBooking(null)} className="flex-1">Annulla</Button>
              <Button onClick={handleSaveBookingEdit} className="flex-1">Salva Modifiche</Button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'config' && (
        <div className="animate-in fade-in space-y-8">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 flex items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-white">Regole Globali</h3>
              <p className="text-sm text-slate-400">Preavviso minimo prenotazione (ore)</p>
            </div>
            <div className="flex items-center gap-2">
              <input type="number" className="w-20 p-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-center" value={noticeHours} onChange={(e) => setNoticeHours(Number(e.target.value))} />
              <Button onClick={handleUpdateNotice} className="text-xs">Salva</Button>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-xl font-bold text-white">Configurazione Sport</h3>
            {config.sports.map((sport) => (
              <div key={sport.id} className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                <div className="p-4 bg-slate-800 flex items-center justify-between cursor-pointer hover:bg-slate-750" onClick={() => setExpandedSportId(expandedSportId === sport.id ? null : sport.id)}>
                  <div className="flex items-center gap-4">
                    <div className="text-2xl">{sport.emoji}</div>
                    <h4 className="text-lg font-bold text-white">{sport.name}</h4>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={(e) => { e.stopPropagation(); removeSport(sport.id); }} className="text-xs text-red-400 hover:text-red-300 ml-2">Elimina</button>
                    <div className={`transform transition-transform ${expandedSportId === sport.id ? 'rotate-180' : ''}`}>▼</div>
                  </div>
                </div>
                {expandedSportId === sport.id && (
                  <div className="p-6 bg-slate-900/50 border-t border-slate-700 grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-3">
                      <h5 className="text-sm font-bold text-indigo-400 uppercase tracking-wider">Sedi & Calendari</h5>
                      {sport.locations.map((loc) => (
                        <div key={loc.id} className="bg-slate-800 p-3 rounded border border-slate-700 text-sm space-y-2">
                          <div className="flex justify-between items-center text-white font-bold">{loc.name}</div>
                          <select
                            className="w-full bg-slate-900 border border-slate-600 rounded text-xs text-slate-300 p-1 mt-2"
                            value={loc.googleCalendarId || ''}
                            onChange={(e) => handleUpdateLocation(sport.id, loc.id, { googleCalendarId: e.target.value })}
                          >
                            <option value="">-- Calendario Default --</option>
                            {userCalendars.map((c) => <option key={c.id} value={c.id}>{c.summary}</option>)}
                          </select>
                        </div>
                      ))}
                      <div className="bg-slate-800/50 p-2 rounded border border-slate-700/50 space-y-2">
                        <input placeholder="Nome Sede" className="w-full bg-transparent border-b border-slate-600 text-xs p-1 text-white" value={newLocName} onChange={(e) => setNewLocName(e.target.value)} />
                        <input placeholder="Indirizzo (opzionale)" className="w-full bg-transparent border-b border-slate-600 text-xs p-1 text-white" value={newLocAddr} onChange={(e) => setNewLocAddr(e.target.value)} />
                        <button onClick={() => handleAddLocation(sport.id)} className="w-full bg-slate-700 hover:bg-slate-600 text-xs text-white py-1 rounded">Aggiungi Sede</button>
                      </div>
                    </div>
                    {/* Other columns per sport (lesson types, durations...) could be here */}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB: SCHEDULE */}
      {activeTab === 'schedule' && (
        <div className="max-w-4xl mx-auto animate-in fade-in space-y-6">
          <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6 flex flex-col md:flex-row justify-between items-center gap-4">
            <div>
              <h2 className="text-xl font-bold text-white">Configura Orari</h2>
              <p className="text-sm text-slate-400">Gestisci orari standard e chiusure straordinarie.</p>
            </div>
            <div className="flex gap-2">
              <select
                className="p-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm"
                value={selectedScheduleSportId}
                onChange={(e) => {
                  const newSportId = e.target.value;
                  setSelectedScheduleSportId(newSportId);
                  const sport = config.sports.find((s) => s.id === newSportId);
                  if (sport && sport.locations.length > 0) {
                    setSelectedScheduleLocId(sport.locations[0].id);
                  } else {
                    setSelectedScheduleLocId('');
                  }
                }}
              >
                <option value="" disabled>Seleziona Sport</option>
                {config.sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>

              <select
                className="p-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm"
                value={selectedScheduleLocId}
                onChange={(e) => setSelectedScheduleLocId(e.target.value)}
              >
                <option value="" disabled>Seleziona Sede</option>
                {config.sports.find((s) => s.id === selectedScheduleSportId)?.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </div>

          {selectedScheduleSportId ? (
            <>
              {editingSchedule && (
                <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
                  <div className="p-4 bg-slate-800/80 border-b border-slate-700 flex justify-between items-center">
                    <h3 className="font-bold text-white">Orario Settimanale Standard (Sede: {config.sports.find((s) => s.id === selectedScheduleSportId)?.locations.find((l) => l.id === selectedScheduleLocId)?.name || '-'})</h3>
                  </div>

                  <div className="p-4 space-y-1">
                    {Object.keys(editingSchedule).map((dayKey) => {
                      const day = dayKey as keyof WeeklySchedule;
                      const rawDayData = editingSchedule[day];
                      const dayData = ensurePeriods(rawDayData);
                      const periods: { start: string; end: string }[] = (dayData as any).periods || [];
                      return (
                        <div key={day} className={`p-3 rounded-lg border transition-all ${dayData.isOpen ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-900/30 border-transparent opacity-60'}`}>
                          <div className="flex items-start gap-4">
                            <div className="w-32 font-medium text-slate-200 capitalize flex items-center gap-2">
                              <input type="checkbox" checked={dayData.isOpen} onChange={(e) => handleScheduleChange(day, 'isOpen', e.target.checked)} className="w-4 h-4 rounded border-slate-600" />
                              {dayLabels[day]}
                            </div>

                            {dayData.isOpen && (
                              <div className="w-full space-y-2">
                                {periods.length === 0 ? (
                                  <div className="text-sm text-slate-400 italic">Nessun intervallo configurato — aggiungi uno per iniziare.</div>
                                ) : (
                                  periods.map((p, idx) => (
                                    <div key={idx} className="flex items-center gap-2">
                                      <input type="time" value={p.start} onChange={(e) => handlePeriodChange(day, idx, 'start', e.target.value)} className="bg-slate-900 border border-slate-600 rounded p-2" />
                                      <span className="text-slate-500">-</span>
                                      <input type="time" value={p.end} onChange={(e) => handlePeriodChange(day, idx, 'end', e.target.value)} className="bg-slate-900 border border-slate-600 rounded p-2" />
                                      <button onClick={() => handleRemovePeriod(day, idx)} className="text-red-400 hover:text-red-300 text-sm px-2">Rimuovi</button>
                                    </div>
                                  ))
                                )}

                                <div className="flex items-center gap-2 mt-2">
                                  <button onClick={() => handleAddPeriod(day)} className="px-3 py-1 bg-slate-700 text-sm rounded text-white">+ Aggiungi Intervallo</button>
                                  <p className="text-xs text-slate-400 ml-2">Puoi aggiungere più intervalli (es. mattina e pomeriggio).</p>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="p-4 bg-slate-800/50 border-t border-slate-700 flex justify-end">
                    <Button onClick={handleSaveSchedule} className="text-sm">Salva Orario Settimanale</Button>
                  </div>
                </div>
              )}

              <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
                <div className="p-4 bg-slate-800/80 border-b border-slate-700">
                  <h3 className="font-bold text-white">Eccezioni e Chiusure</h3>
                  <p className="text-xs text-slate-400">Pianifica chiusure o orari speciali per giorni specifici.</p>
                </div>

                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <label className="block text-xs font-bold uppercase text-slate-500">Nuova Eccezione</label>
                    <input type="date" className="w-full p-2 bg-slate-900 border border-slate-600 rounded text-white" value={exceptionDate} onChange={(e) => setExceptionDate(e.target.value)} />

                    <div className="flex items-center gap-3 p-4 bg-slate-900 rounded-xl border border-slate-700">
                      <input type="checkbox" checked={exceptionData.isOpen} onChange={(e) => setExceptionData({ ...exceptionData, isOpen: e.target.checked })} className="w-6 h-6 rounded bg-slate-800" />
                      <label htmlFor="isOpenCheck" className={`font-bold cursor-pointer text-lg ${exceptionData.isOpen ? 'text-emerald-400' : 'text-red-400'}`}>
                        {exceptionData.isOpen ? 'APERTO' : 'CHIUSO'}
                      </label>
                    </div>

                    {exceptionData.isOpen && (
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="text-xs text-slate-500 block mb-1">Dalle</label>
                          <input type="time" value={exceptionData.start} onChange={(e) => setExceptionData({ ...exceptionData, start: e.target.value })} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white" />
                        </div>
                        <div className="flex-1">
                          <label className="text-xs text-slate-500 block mb-1">Alle</label>
                          <input type="time" value={exceptionData.end} onChange={(e) => setExceptionData({ ...exceptionData, end: e.target.value })} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white" />
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-2 p-3 bg-indigo-900/10 rounded border border-indigo-500/30">
                      <input id="allLocsCheck" type="checkbox" checked={applyToAllLocs} onChange={(e) => setApplyToAllLocs(e.target.checked)} className="w-4 h-4 rounded text-indigo-600" />
                      <label htmlFor="allLocsCheck" className="text-xs text-slate-300 cursor-pointer">Applica a TUTTE le sedi di questo sport</label>
                    </div>

                    <Button onClick={handleSaveException} disabled={!exceptionDate} className="w-full">Salva Regola</Button>
                  </div>

                  <div className="border-l border-slate-700 pl-8 space-y-3 max-h-96 overflow-y-auto">
                    <label className="block text-xs font-bold uppercase text-slate-500 sticky top-0 bg-slate-800 py-1 z-10">Eccezioni Attive (Prossimamente)</label>
                    {Object.keys(sportWideExceptions).length === 0 ? (
                      <p className="text-sm text-slate-500 italic">Nessuna eccezione configurata (o quelle vecchie sono state rimosse).</p>
                    ) : (
                      Object.entries(sportWideExceptions)
                        .sort()
                        .map(([date, locMap]) => {
                          const sport = config.sports.find((s) => s.id === selectedScheduleSportId);
                          const totalLocs = sport?.locations.length || 0;
                          const locIds = Object.keys(locMap);
                          const affectedLocsCount = locIds.length;

                          // Take the first schedule to display data
                          const data = locMap[locIds[0]];

                          // Check if it's the same schedule for all locations of this sport
                          const isAllLocs = affectedLocsCount === totalLocs;
                          const affectedLocNames = locIds.map((id) => sport?.locations.find((l) => l.id === id)?.name).join(', ');

                          return (
                            <div key={date} className={`flex justify-between items-center p-3 rounded border ${data.isOpen ? 'bg-slate-900 border-slate-700' : 'bg-red-900/20 border-red-500/20'}`}>
                              <div className="flex-1 min-w-0 pr-2">
                                <div className="font-bold text-white text-sm">{new Date(date).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
                                <div className={`text-xs font-medium mb-1 ${data.isOpen ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {data.isOpen ? `Aperto: ${data.start} - ${data.end}` : 'CHIUSO TUTTO IL GIORNO'}
                                </div>
                                <div className="text-[10px] text-slate-400 uppercase font-bold truncate">
                                  {isAllLocs ? 'Sedi: TUTTE LE SEDI' : `Sedi: ${affectedLocNames}`}
                                </div>
                              </div>
                              <button onClick={() => handleDeleteException(date, Object.keys(locMap))} className="text-red-400 hover:text-white text-[10px] px-2 py-1 rounded border border-red-500/20 hover:bg-red-500/20 flex-shrink-0">Elimina</button>
                            </div>
                          );
                        })
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="p-10 text-center text-slate-500 bg-slate-800/30 rounded-xl border border-slate-800">Seleziona uno sport per configurare gli orari.</div>
          )}
        </div>
      )}

      {activeTab === 'home' && (
        <div className="max-w-2xl mx-auto animate-in fade-in space-y-6">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <h3 className="text-lg font-bold text-white mb-6">Testi Pagina Iniziale</h3>
            <div className="space-y-6">
              <div>
                <label className="text-xs text-slate-400 uppercase font-bold mb-2 block">Titolo</label>
                <input className="w-full p-4 bg-slate-900 border border-slate-600 rounded-lg text-white text-xl font-bold" value={homeTitle} onChange={(e) => setHomeTitle(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-400 uppercase font-bold mb-2 block">Sottotitolo</label>
                <textarea className="w-full p-4 bg-slate-900 border border-slate-600 rounded-lg text-white text-lg h-32 resize-none" value={homeSubtitle} onChange={(e) => setHomeSubtitle(e.target.value)} />
              </div>
              <Button onClick={handleUpdateHome} className="w-full">Salva</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
