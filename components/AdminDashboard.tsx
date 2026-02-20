import React, { useState, useEffect, useMemo } from 'react';
import { CalendarEvent, AppConfig, WeeklySchedule, SportLocation, Sport, DailySchedule, Booking } from '../types';
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
  updateHomeConfig,
  updateMinBookingNotice,
  initConfigListener,
  updateImportBusyCalendars,
  updateLocationException,
  updateMultipleLocationsExceptions,
  initBookingListener
} from '../services/configService';
import { logout } from '../services/authService';
import Button from './Button';

interface AdminDashboardProps {
  onLogout: () => void;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onLogout }) => {
  const [activeTab, setActiveTab] = useState<'calendar' | 'bookings' | 'config' | 'schedule' | 'home'>('calendar');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [rawBookings, setRawBookings] = useState<Booking[]>([]);

  const [isConnected, setIsConnected] = useState(isCalendarConnected());
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [config, setConfig] = useState<AppConfig>(getAppConfig());

  // Calendar State
  const [userCalendars, setUserCalendars] = useState<{ id: string; summary: string; primary?: boolean }[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);
  const [loadingCalendars, setLoadingCalendars] = useState(false);

  const [expandedSportId, setExpandedSportId] = useState<string | null>(null);

  // Temp forms for adding nested items
  const [newSportName, setNewSportName] = useState('');
  const [newSportEmoji, setNewSportEmoji] = useState('🏅');
  const [newSportDescription, setNewSportDescription] = useState('');

  const [newLocName, setNewLocName] = useState('');
  const [newLocAddr, setNewLocAddr] = useState('');
  const [newLessonType, setNewLessonType] = useState('');
  const [newDuration, setNewDuration] = useState('60');

  // Editing Sport Meta
  const [editingSportId, setEditingSportId] = useState<string | null>(null);
  const [tempSport, setTempSport] = useState<Partial<Sport>>({});

  // Editing Location Meta
  const [editingLocId, setEditingLocId] = useState<string | null>(null);
  const [tempLocName, setTempLocName] = useState('');
  const [tempLocAddr, setTempLocAddr] = useState('');

  // Home Config Form
  const [homeTitle, setHomeTitle] = useState('');
  const [homeSubtitle, setHomeSubtitle] = useState('');
  const [noticeHours, setNoticeHours] = useState<number>(0);

  // Schedule Config State
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

  const refreshEvents = () => {
    setEvents(getAllCalendarEvents());
    setIsConnected(isCalendarConnected());
  };

  // FIX: se risulta "Connesso" ma la lista calendari è vuota, prova auto-riconnessione
  const fetchUserCalendars = async (opts?: { autoReconnect?: boolean }) => {
    setLoadingCalendars(true);
    try {
      const cals = await listGoogleCalendars();
      setUserCalendars(cals);

      if (opts?.autoReconnect && isCalendarConnected() && (!cals || cals.length === 0)) {
        try {
          await connectGoogleCalendar();
          setIsConnected(true);
          const cals2 = await listGoogleCalendars();
          setUserCalendars(cals2);
        } catch (e) {
          console.warn('Auto-reconnect failed while calendars list was empty', e);
        }
      }
    } catch (e: any) {
      console.error('Could not list calendars', e);

      if (e?.status === 401) {
        setIsConnected(false);
        setUserCalendars([]);

        if (opts?.autoReconnect) {
          try {
            await connectGoogleCalendar();
            setIsConnected(true);
            const cals2 = await listGoogleCalendars();
            setUserCalendars(cals2);
          } catch (e2) {
            console.warn('Auto-reconnect failed after 401', e2);
          }
        }
      }
    } finally {
      setLoadingCalendars(false);
    }
  };

  const handleReconnectCalendar = async () => {
    setIsConnecting(true);
    try {
      await connectGoogleCalendar();
      setIsConnected(true);
      await fetchUserCalendars();
    } catch (e: any) {
      if (e && e.error === 'access_denied') {
        alert('ACCESSO NEGATO: Aggiungi la tua email ai Test Users in Google Cloud Console.');
      } else {
        alert('Errore riconnessione Google Calendar.');
      }
    } finally {
      setIsConnecting(false);
      refreshEvents();
    }
  };

  useEffect(() => {
    const init = async () => {
      await initGoogleClient();

      const connected = isCalendarConnected();
      setIsConnected(connected);

      // auto-load (e auto-reconnect se serve)
      if (connected) {
        fetchUserCalendars({ autoReconnect: true });
      }
    };
    init();

    const unsubConfig = initConfigListener((newConfig) => {
      setConfig(newConfig);
      setHomeTitle(newConfig.homeTitle);
      setHomeSubtitle(newConfig.homeSubtitle);
      setNoticeHours((newConfig.minBookingNoticeMinutes || 0) / 60);
      if (newConfig.importBusyCalendars) {
        setSelectedCalendarIds(newConfig.importBusyCalendars);
      }
    });

    const unsubBookings = initBookingListener((newBookings) => {
      // Mostra solo quelle NON passate e non "EXTERNAL_BUSY" (se presente)
      const now = new Date();
      const filtered = newBookings
        .filter((b) => (b as any).sportName !== 'EXTERNAL_BUSY')
        .filter((b) => new Date(b.startTime) >= now)
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      setRawBookings(filtered);
      setEvents(getAllCalendarEvents());
    });

    refreshEvents();

    return () => {
      unsubConfig();
      unsubBookings();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isConnected && userCalendars.length === 0) {
      fetchUserCalendars({ autoReconnect: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

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

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayString = today.toISOString().split('T')[0];

    const aggregated: Record<string, Record<string, DailySchedule>> = {};
    sport.locations.forEach((loc) => {
      if (loc.scheduleExceptions) {
        (Object.entries(loc.scheduleExceptions) as [string, DailySchedule][]).forEach(([date, schedule]) => {
          if (date >= todayString) {
            if (!aggregated[date]) aggregated[date] = {};
            aggregated[date][loc.id] = schedule;
          }
        });
      }
    });
    return aggregated;
  }, [selectedScheduleSportId, config.sports]);

  const handleConnectCalendar = async () => {
    setIsConnecting(true);
    try {
      await connectGoogleCalendar();
      setIsConnected(true);
      await fetchUserCalendars();
    } catch (e: any) {
      if (e && e.error === 'access_denied') {
        alert('ACCESSO NEGATO: Aggiungi la tua email ai Test Users in Google Cloud Console.');
      } else {
        alert('Errore connessione Google Calendar.');
      }
    } finally {
      setIsConnecting(false);
      refreshEvents();
    }
  };

  const handleDisconnect = () => {
    disconnectGoogleCalendar();
    setIsConnected(false);
    setUserCalendars([]);
    refreshEvents();
  };

  const handleToggleCalendar = (calId: string) => {
    const newSelection = selectedCalendarIds.includes(calId)
      ? selectedCalendarIds.filter((id) => id !== calId)
      : [...selectedCalendarIds, calId];

    setSelectedCalendarIds(newSelection);
    updateImportBusyCalendars(newSelection);
  };

  const handleSyncNow = async () => {
    if (!isConnected) return;
    setIsSyncing(true);
    try {
      const calendarsToSync = config.importBusyCalendars || selectedCalendarIds;
      const count = await syncGoogleEventsToFirebase(calendarsToSync);
      alert(`Sincronizzazione completata! ${count} impegni importati.`);
      refreshEvents();
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
      refreshEvents();
    } catch (e) {
      alert("Errore durante l'esportazione.");
    } finally {
      setIsExporting(false);
    }
  };

  // --- SPORT ACTIONS ---
  const handleAddSport = () => {
    if (!newSportName.trim()) return;

    const beforeIds = new Set(config.sports.map((s) => s.id));
    addSport(newSportName.trim());

    setTimeout(() => {
      const after = getAppConfig();
      const created =
        after.sports.find((s) => !beforeIds.has(s.id) && s.name === newSportName.trim()) ||
        after.sports.find((s) => !beforeIds.has(s.id));
      if (created) {
        updateSport(created.id, {
          emoji: (newSportEmoji || '🏅').trim(),
          description: newSportDescription.trim()
        });
      }
    }, 0);

    setNewSportName('');
    setNewSportEmoji('🏅');
    setNewSportDescription('');
  };

  const startEditSport = (sport: Sport) => {
    setEditingSportId(sport.id);
    setTempSport({ ...sport });
  };

  const cancelEditSport = () => {
    setEditingSportId(null);
    setTempSport({});
  };

  const saveEditSport = () => {
    if (editingSportId && tempSport.name) {
      updateSport(editingSportId, {
        ...tempSport,
        name: tempSport.name.trim(),
        emoji: (tempSport.emoji || '🏅').trim(),
        description: (tempSport.description || '').trim()
      });
      setEditingSportId(null);
    }
  };

  // --- NESTED ACTIONS ---
  const handleAddLocation = (sportId: string) => {
    if (!newLocName.trim()) return;
    addSportLocation(sportId, newLocName.trim(), newLocAddr.trim());
    setNewLocName('');
    setNewLocAddr('');
  };

  const handleUpdateLocation = (sportId: string, locId: string, updates: Partial<SportLocation>) => {
    updateSportLocation(sportId, locId, updates);
  };

  const startEditLocation = (loc: SportLocation) => {
    setEditingLocId(loc.id);
    setTempLocName(loc.name);
    setTempLocAddr(loc.address);
  };

  const cancelEditLocation = () => {
    setEditingLocId(null);
    setTempLocName('');
    setTempLocAddr('');
  };

  const saveEditLocation = (sportId: string, locId: string) => {
    if (!tempLocName.trim()) {
      alert('Il nome della sede è obbligatorio.');
      return;
    }
    updateSportLocation(sportId, locId, {
      name: tempLocName.trim(),
      address: tempLocAddr.trim()
    });
    cancelEditLocation();
  };

  const handleDeleteLocation = (sportId: string, locId: string) => {
    if (!window.confirm('Sei sicuro di voler eliminare questa sede?')) return;

    removeSportLocation(sportId, locId);

    if (editingLocId === locId) cancelEditLocation();

    if (selectedScheduleSportId === sportId && selectedScheduleLocId === locId) {
      const sport = config.sports.find((s) => s.id === sportId);
      const remaining = sport?.locations.filter((l) => l.id !== locId) || [];
      setSelectedScheduleLocId(remaining[0]?.id || '');
    }
  };

  const handleUpdateLessonType = (sportId: string, typeId: string, newName: string) => {
    const sport = config.sports.find((s) => s.id === sportId);
    if (sport) {
      const newTypes = sport.lessonTypes.map((t) => (t.id === typeId ? { ...t, name: newName } : t));
      updateSport(sportId, { lessonTypes: newTypes });
    }
  };

  const handleAddLessonType = (sportId: string) => {
    if (!newLessonType.trim()) return;
    addSportLessonType(sportId, newLessonType.trim());
    setNewLessonType('');
  };

  const handleAddDuration = (sportId: string) => {
    const mins = parseInt(newDuration);
    if (mins > 0) {
      addSportDuration(sportId, mins);
    }
  };

  // --- SCHEDULE ACTIONS ---
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
      return {
        ...prev,
        [day]: { ...prev[day], [field]: value }
      };
    });
  };

  // --- EXCEPTIONS ---
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
      alert(`Eccezione salvata per la sede selezionata.`);
    }

    setExceptionDate('');
  };

  const handleDeleteException = (date: string, locIds: string[]) => {
    if (!selectedScheduleSportId) return;

    const msg =
      locIds.length > 1
        ? `Rimuovere questa eccezione da TUTTE le sedi interessate (${locIds.length})?`
        : `Rimuovere questa eccezione per questa sede?`;

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
    <div className="max-w-6xl mx-auto px-4 py-8">
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
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'calendar' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Calendario
            </button>
            <button
              onClick={() => setActiveTab('bookings')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'bookings' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Prenotazioni
            </button>
            <button
              onClick={() => setActiveTab('config')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'config' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Offerta
            </button>
            <button
              onClick={() => setActiveTab('schedule')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'schedule' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Orari
            </button>
            <button
              onClick={() => setActiveTab('home')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'home' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Home
            </button>
          </div>
          <Button
            variant="outline"
            onClick={handleLogout}
            className="ml-2 border-red-900/50 text-red-400 hover:bg-red-900/20 hover:border-red-500/50"
          >
            Esci
          </Button>
        </div>
      </div>

      {/* TAB: CALENDAR */}
      {activeTab === 'calendar' && (
        <div className="space-y-8 animate-in fade-in">
          <div
            className={`p-6 rounded-xl border ${
              isConnected ? 'bg-emerald-900/10 border-emerald-500/30' : 'bg-slate-800 border-slate-700'
            }`}
          >
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-4">
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center ${
                    isConnected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-500'
                  }`}
                >
                  📅
                </div>
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

            {isConnected && (
              <div className="mt-4 flex justify-end gap-3">
                <button onClick={() => fetchUserCalendars({ autoReconnect: true })} className="text-xs text-indigo-300 hover:text-indigo-200">
                  Ricarica calendari
                </button>
                <button onClick={handleDisconnect} className="text-xs text-red-400 hover:text-red-300">
                  Disconnetti Google
                </button>
              </div>
            )}
          </div>

          {isConnected && (
            <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-white">Calendari "Occupati" (Import)</h3>
                <button
                  onClick={() => fetchUserCalendars({ autoReconnect: true })}
                  disabled={loadingCalendars}
                  className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                >
                  <svg className={`w-4 h-4 ${loadingCalendars ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    ></path>
                  </svg>
                  Aggiorna Lista
                </button>
              </div>

              {loadingCalendars ? (
                <p className="text-slate-400">Caricamento calendari...</p>
              ) : userCalendars.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-h-40 overflow-y-auto">
                  {userCalendars.map((cal) => (
                    <label
                      key={cal.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                        selectedCalendarIds.includes(cal.id)
                          ? 'bg-indigo-900/20 border-indigo-500/50'
                          : 'bg-slate-900 border-slate-700 hover:border-slate-600'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedCalendarIds.includes(cal.id)}
                        onChange={() => handleToggleCalendar(cal.id)}
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
                  <Button onClick={handleReconnectCalendar} isLoading={isConnecting} variant="ghost" className="text-xs">
                    Riconnetti Account
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB: BOOKINGS */}
      {activeTab === 'bookings' && (
        <div className="animate-in fade-in space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold text-white">Lezioni Prenotate (da fare)</h2>
          </div>

          {rawBookings.length === 0 ? (
            <div className="text-center py-20 bg-slate-800/50 rounded-xl border border-slate-700 text-slate-500">
              Nessuna prenotazione futura trovata.
            </div>
          ) : (
            <div className="space-y-4">
              {rawBookings.map((booking) => (
                <div key={booking.id} className="p-4 rounded-xl border bg-slate-800/50 border-slate-700 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-bold text-lg text-white">
                        {new Date(booking.startTime).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}
                      </span>
                      <span className="bg-slate-700 text-slate-200 px-2 py-0.5 rounded text-sm font-mono">
                        {new Date(booking.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <div className="text-slate-300 font-medium">
                      {booking.sportName} - {booking.locationName}
                    </div>

                    <div className="text-sm text-slate-400 mt-1">
                      <span className="font-bold text-indigo-300">{booking.customerName}</span>
                      {booking.customerPhone ? ` • ${booking.customerPhone}` : ''} • {booking.customerEmail}
                    </div>

                    {booking.notes && (
                      <div className="text-xs text-slate-500 mt-2">
                        Note: <span className="text-slate-400">{booking.notes}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2 w-full md:w-auto min-w-[160px]">
                    <span className="text-xs bg-slate-900 px-2 py-1 rounded text-slate-400 border border-slate-700 w-full text-center">
                      {booking.lessonTypeName || 'Tipo lezione'}
                    </span>
                    <span className="text-xs bg-slate-900 px-2 py-1 rounded text-slate-400 border border-slate-700 w-full text-center">
                      {booking.durationMinutes} min
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB: CONFIG */}
      {activeTab === 'config' && (
        <div className="animate-in fade-in space-y-8">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 flex items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-white">Regole Globali</h3>
              <p className="text-sm text-slate-400">Preavviso minimo prenotazione (ore)</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                className="w-20 p-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-center"
                value={noticeHours}
                onChange={(e) => setNoticeHours(Number(e.target.value))}
              />
              <Button onClick={handleUpdateNotice} className="text-xs">
                Salva
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-xl font-bold text-white">Configurazione Sport</h3>

            {config.sports.map((sport) => (
              <div key={sport.id} className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                <div
                  className="p-4 bg-slate-800 flex items-center justify-between cursor-pointer hover:bg-slate-750"
                  onClick={() => setExpandedSportId(expandedSportId === sport.id ? null : sport.id)}
                >
                  <div className="flex items-center gap-4">
                    {editingSportId === sport.id ? (
                      <div className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-2">
                          <input
                            className="w-20 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-sm"
                            placeholder="Emoji"
                            value={tempSport.emoji || ''}
                            onChange={(e) => setTempSport({ ...tempSport, emoji: e.target.value })}
                          />
                          <input
                            className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white"
                            value={tempSport.name || ''}
                            onChange={(e) => setTempSport({ ...tempSport, name: e.target.value })}
                          />
                        </div>
                        <input
                          className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-xs"
                          placeholder="Descrizione"
                          value={tempSport.description || ''}
                          onChange={(e) => setTempSport({ ...tempSport, description: e.target.value })}
                        />
                      </div>
                    ) : (
                      <>
                        <div className="text-2xl">{sport.emoji}</div>
                        <h4 className="text-lg font-bold text-white">{sport.name}</h4>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {editingSportId === sport.id ? (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelEditSport();
                          }}
                          className="text-xs text-slate-300 hover:text-white border border-slate-600 hover:bg-slate-700 px-2 py-1 rounded"
                        >
                          Annulla
                        </button>
                        <Button
                          onClick={(e) => {
                            e.stopPropagation();
                            saveEditSport();
                          }}
                          className="text-xs py-1"
                        >
                          Salva
                        </Button>
                      </>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditSport(sport);
                        }}
                        className="text-xs text-slate-400 hover:text-white"
                      >
                        Modifica
                      </button>
                    )}

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeSport(sport.id);
                      }}
                      className="text-xs text-red-400 hover:text-red-300 ml-2"
                    >
                      Elimina
                    </button>
                    <div className={`transform transition-transform ${expandedSportId === sport.id ? 'rotate-180' : ''}`}>▼</div>
                  </div>
                </div>

                {expandedSportId === sport.id && (
                  <div className="p-6 bg-slate-900/50 border-t border-slate-700 grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-3">
                      <h5 className="text-sm font-bold text-indigo-400 uppercase tracking-wider">Sedi & Calendari</h5>

                      {sport.locations.map((loc) => {
                        const isEditingLoc = editingLocId === loc.id;

                        return (
                          <div key={loc.id} className="bg-slate-800 p-3 rounded border border-slate-700 text-sm space-y-2">
                            <div className="flex justify-between items-center gap-2">
                              {!isEditingLoc ? (
                                <>
                                  <div className="text-white font-bold truncate">{loc.name}</div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <button
                                      onClick={() => startEditLocation(loc)}
                                      className="text-[11px] text-slate-300 hover:text-white border border-slate-600 hover:bg-slate-700 px-2 py-1 rounded"
                                    >
                                      Modifica
                                    </button>
                                    <button
                                      onClick={() => handleDeleteLocation(sport.id, loc.id)}
                                      className="text-[11px] text-red-400 hover:text-red-300 border border-red-500/30 hover:bg-red-500/10 px-2 py-1 rounded"
                                    >
                                      Elimina
                                    </button>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="text-white font-bold">Modifica sede</div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <button
                                      onClick={cancelEditLocation}
                                      className="text-[11px] text-slate-300 hover:text-white border border-slate-600 hover:bg-slate-700 px-2 py-1 rounded"
                                    >
                                      Annulla
                                    </button>
                                    <button
                                      onClick={() => saveEditLocation(sport.id, loc.id)}
                                      className="text-[11px] text-emerald-300 hover:text-white border border-emerald-500/30 hover:bg-emerald-500/10 px-2 py-1 rounded"
                                    >
                                      Salva
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>

                            {!isEditingLoc ? (
                              <div className="text-xs text-slate-400">{loc.address}</div>
                            ) : (
                              <div className="space-y-2">
                                <input
                                  className="w-full bg-slate-900 border border-slate-600 rounded text-xs text-white p-2"
                                  placeholder="Nome sede"
                                  value={tempLocName}
                                  onChange={(e) => setTempLocName(e.target.value)}
                                />
                                <input
                                  className="w-full bg-slate-900 border border-slate-600 rounded text-xs text-white p-2"
                                  placeholder="Indirizzo"
                                  value={tempLocAddr}
                                  onChange={(e) => setTempLocAddr(e.target.value)}
                                />
                              </div>
                            )}

                            <select
                              className="w-full bg-slate-900 border border-slate-600 rounded text-xs text-slate-300 p-1 mt-2"
                              value={loc.googleCalendarId || ''}
                              onChange={(e) =>
                                handleUpdateLocation(sport.id, loc.id, { googleCalendarId: e.target.value || undefined })
                              }
                              disabled={!isConnected || userCalendars.length === 0}
                            >
                              <option value="">-- Calendario Default --</option>
                              {userCalendars.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.summary}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })}

                      <div className="bg-slate-800/50 p-2 rounded border border-slate-700/50 space-y-2">
                        <input
                          placeholder="Nome Sede"
                          className="w-full bg-transparent border-b border-slate-600 text-xs p-1 text-white"
                          value={newLocName}
                          onChange={(e) => setNewLocName(e.target.value)}
                        />
                        <input
                          placeholder="Indirizzo"
                          className="w-full bg-transparent border-b border-slate-600 text-xs p-1 text-white"
                          value={newLocAddr}
                          onChange={(e) => setNewLocAddr(e.target.value)}
                        />
                        <button
                          onClick={() => handleAddLocation(sport.id)}
                          className="w-full bg-slate-700 hover:bg-slate-600 text-xs text-white py-1 rounded"
                        >
                          Aggiungi Sede
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h5 className="text-sm font-bold text-indigo-400 uppercase tracking-wider">Tipi Lezione</h5>
                      {sport.lessonTypes.map((lt) => (
                        <div key={lt.id} className="bg-slate-800 p-2 rounded border border-slate-700 flex justify-between items-center text-sm text-white">
                          <input
                            className="bg-transparent border-b border-transparent hover:border-slate-600 focus:border-indigo-500 focus:outline-none text-white w-full mr-2"
                            value={lt.name}
                            onChange={(e) => handleUpdateLessonType(sport.id, lt.id, e.target.value)}
                          />
                          <button onClick={() => removeSportLessonType(sport.id, lt.id)} className="text-red-400 hover:text-white">
                            ×
                          </button>
                        </div>
                      ))}
                      <div className="flex gap-2">
                        <input
                          placeholder="Es. Singola"
                          className="flex-1 bg-slate-800 border border-slate-600 text-xs p-1 rounded text-white"
                          value={newLessonType}
                          onChange={(e) => setNewLessonType(e.target.value)}
                        />
                        <button onClick={() => handleAddLessonType(sport.id)} className="bg-slate-700 hover:bg-slate-600 text-xs text-white px-2 rounded">
                          +
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h5 className="text-sm font-bold text-indigo-400 uppercase tracking-wider">Durate (min)</h5>
                      <div className="flex flex-wrap gap-2">
                        {sport.durations.map((d) => (
                          <div key={d} className="bg-slate-800 px-2 py-1 rounded border border-slate-700 flex items-center gap-2 text-sm text-white">
                            {d}m
                            <button onClick={() => removeSportDuration(sport.id, d)} className="text-slate-500 hover:text-red-400">
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          placeholder="60"
                          className="w-16 bg-slate-800 border border-slate-600 text-xs p-1 rounded text-white"
                          value={newDuration}
                          onChange={(e) => setNewDuration(e.target.value)}
                        />
                        <button onClick={() => handleAddDuration(sport.id)} className="bg-slate-700 hover:bg-slate-600 text-xs text-white px-2 rounded">
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 max-w-2xl">
              <div className="text-sm font-bold text-white mb-2">Aggiungi nuovo sport</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input
                  className="p-2 bg-slate-900 border border-slate-600 rounded-lg text-white"
                  placeholder="Nome (es. Padel)"
                  value={newSportName}
                  onChange={(e) => setNewSportName(e.target.value)}
                />
                <input
                  className="p-2 bg-slate-900 border border-slate-600 rounded-lg text-white"
                  placeholder="Emoji (es. 🎾)"
                  value={newSportEmoji}
                  onChange={(e) => setNewSportEmoji(e.target.value)}
                />
                <input
                  className="p-2 bg-slate-900 border border-slate-600 rounded-lg text-white"
                  placeholder="Descrizione"
                  value={newSportDescription}
                  onChange={(e) => setNewSportDescription(e.target.value)}
                />
              </div>
              <div className="mt-3">
                <Button onClick={handleAddSport}>Aggiungi Sport</Button>
              </div>
              <div className="text-[11px] text-slate-400 mt-2">
                Nota: la creazione usa <code>addSport(name)</code> e poi aggiorna emoji/descrizione automaticamente.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB: SCHEDULE */}
      {activeTab === 'schedule' && (
        <div className="max-w-4xl mx-auto animate-in fade-in space-y-6">
          <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
            <div className="p-6 border-b border-slate-700 bg-slate-800/80 flex flex-col md:flex-row justify-between items-center gap-4">
              <div>
                <h2 className="text-xl font-bold text-white">Orari Apertura</h2>
                <p className="text-sm text-slate-400">Configura orari standard e chiusure straordinarie.</p>
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
                  <option value="" disabled>
                    Seleziona Sport
                  </option>
                  {config.sports.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <select
                  className="p-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm"
                  value={selectedScheduleLocId}
                  onChange={(e) => setSelectedScheduleLocId(e.target.value)}
                  disabled={!selectedScheduleSportId}
                >
                  <option value="" disabled>
                    Seleziona Sede
                  </option>
                  {config.sports
                    .find((s) => s.id === selectedScheduleSportId)
                    ?.locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {editingSchedule ? (
              <>
                <div className="p-6 bg-slate-800/30 border-b border-slate-700 flex justify-between items-center">
                  <span className="text-sm text-slate-300 font-medium">Intervallo Slot</span>
                  <div className="flex items-center gap-3 bg-slate-900 p-2 rounded-lg border border-slate-700">
                    <button
                      onClick={() => setEditingSlotInterval(60)}
                      className={`px-3 py-1 rounded text-xs font-bold transition-all ${
                        editingSlotInterval === 60 ? 'bg-indigo-600 text-white' : 'text-slate-500'
                      }`}
                    >
                      60m
                    </button>
                    <button
                      onClick={() => setEditingSlotInterval(30)}
                      className={`px-3 py-1 rounded text-xs font-bold transition-all ${
                        editingSlotInterval === 30 ? 'bg-indigo-600 text-white' : 'text-slate-500'
                      }`}
                    >
                      30m
                    </button>
                  </div>
                </div>

                <div className="p-6 space-y-1">
                  {Object.keys(editingSchedule).map((dayKey) => {
                    const day = dayKey as keyof WeeklySchedule;
                    const dayData = editingSchedule[day];
                    return (
                      <div
                        key={day}
                        className={`grid grid-cols-12 items-center gap-4 p-3 rounded-lg border transition-all ${
                          dayData.isOpen ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-900/30 border-transparent opacity-60'
                        }`}
                      >
                        <div className="col-span-3 font-medium text-slate-200 capitalize flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={dayData.isOpen}
                            onChange={(e) => handleScheduleChange(day, 'isOpen', e.target.checked)}
                            className="w-4 h-4 rounded bg-slate-700 border-slate-600"
                          />
                          {dayLabels[day]}
                        </div>
                        {dayData.isOpen ? (
                          <>
                            <div className="col-span-4 flex items-center gap-2">
                              <input
                                type="time"
                                value={dayData.start}
                                onChange={(e) => handleScheduleChange(day, 'start', e.target.value)}
                                className="bg-slate-900 border border-slate-600 text-white text-sm rounded px-2 py-1"
                              />
                            </div>
                            <div className="col-span-4 flex items-center gap-2">
                              <input
                                type="time"
                                value={dayData.end}
                                onChange={(e) => handleScheduleChange(day, 'end', e.target.value)}
                                className="bg-slate-900 border border-slate-600 text-white text-sm rounded px-2 py-1"
                              />
                            </div>
                          </>
                        ) : (
                          <div className="col-span-8 text-xs text-slate-600 italic">Chiuso</div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="p-6 bg-slate-800/50 border-t border-slate-700 flex justify-end">
                  <Button onClick={handleSaveSchedule}>Salva Orari</Button>
                </div>
              </>
            ) : (
              <div className="p-10 text-center text-slate-500">Seleziona uno sport e una sede per configurare gli orari.</div>
            )}
          </div>

          {selectedScheduleSportId && (
            <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
              <div className="p-4 bg-slate-800/80 border-b border-slate-700">
                <h3 className="font-bold text-white">Eccezioni e Chiusure</h3>
                <p className="text-xs text-slate-400">Pianifica chiusure o orari speciali per giorni specifici.</p>
              </div>

              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <label className="block text-xs font-bold uppercase text-slate-500">Nuova Eccezione</label>
                  <input
                    type="date"
                    className="w-full p-2 bg-slate-900 border border-slate-600 rounded text-white"
                    value={exceptionDate}
                    onChange={(e) => setExceptionDate(e.target.value)}
                  />

                  <div className="flex items-center gap-3 p-4 bg-slate-900 rounded-xl border border-slate-700">
                    <input
                      type="checkbox"
                      checked={exceptionData.isOpen}
                      onChange={(e) => setExceptionData({ ...exceptionData, isOpen: e.target.checked })}
                      className="w-6 h-6 rounded bg-slate-700 border-slate-600"
                      id="isOpenCheck"
                    />
                    <label
                      htmlFor="isOpenCheck"
                      className={`font-bold cursor-pointer text-lg ${exceptionData.isOpen ? 'text-emerald-400' : 'text-red-400'}`}
                    >
                      {exceptionData.isOpen ? 'APERTO' : 'CHIUSO'}
                    </label>
                  </div>

                  {exceptionData.isOpen && (
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-xs text-slate-500 block mb-1">Dalle</label>
                        <input
                          type="time"
                          value={exceptionData.start}
                          onChange={(e) => setExceptionData({ ...exceptionData, start: e.target.value })}
                          className="w-full bg-slate-900 border border-slate-600 rounded text-white p-2"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs text-slate-500 block mb-1">Alle</label>
                        <input
                          type="time"
                          value={exceptionData.end}
                          onChange={(e) => setExceptionData({ ...exceptionData, end: e.target.value })}
                          className="w-full bg-slate-900 border border-slate-600 rounded text-white p-2"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 p-3 bg-indigo-900/10 rounded border border-indigo-500/30">
                    <input
                      type="checkbox"
                      checked={applyToAllLocs}
                      onChange={(e) => setApplyToAllLocs(e.target.checked)}
                      className="w-4 h-4 rounded text-indigo-600"
                      id="allLocsCheck"
                    />
                    <label htmlFor="allLocsCheck" className="text-xs text-slate-300 cursor-pointer">
                      Applica a TUTTE le sedi di questo sport
                    </label>
                  </div>

                  <Button onClick={handleSaveException} disabled={!exceptionDate} className="w-full">
                    Salva Regola
                  </Button>
                </div>

                <div className="border-l border-slate-700 pl-8 space-y-3 max-h-96 overflow-y-auto">
                  <label className="block text-xs font-bold uppercase text-slate-500 sticky top-0 bg-slate-800 py-1 z-10">
                    Eccezioni Attive (Prossimamente)
                  </label>

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

                        const data = locMap[locIds[0]];
                        const isAllLocs = affectedLocsCount === totalLocs;

                        const affectedLocNames = locIds
                          .map((id) => sport?.locations.find((l) => l.id === id)?.name)
                          .filter(Boolean)
                          .join(', ');

                        return (
                          <div
                            key={date}
                            className={`flex justify-between items-center p-3 rounded border ${
                              data.isOpen ? 'bg-slate-900 border-slate-700' : 'bg-red-900/20 border-red-500/30'
                            }`}
                          >
                            <div className="flex-1 min-w-0 pr-2">
                              <div className="font-bold text-white text-sm">
                                {new Date(date).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}
                              </div>
                              <div className={`text-xs font-medium mb-1 ${data.isOpen ? 'text-emerald-400' : 'text-red-400'}`}>
                                {data.isOpen ? `Aperto: ${data.start} - ${data.end}` : 'CHIUSO TUTTO IL GIORNO'}
                              </div>
                              <div className="text-[10px] text-slate-400 uppercase font-bold truncate">
                                {isAllLocs ? 'Sedi: TUTTE LE SEDI' : `Sedi: ${affectedLocNames}`}
                              </div>
                            </div>
                            <button
                              onClick={() => handleDeleteException(date, locIds)}
                              className="text-red-400 hover:text-white text-[10px] px-2 py-1 rounded border border-red-500/20 hover:bg-red-500/20 flex-shrink-0"
                            >
                              Elimina
                            </button>
                          </div>
                        );
                      })
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB: HOME */}
      {activeTab === 'home' && (
        <div className="max-w-2xl mx-auto animate-in fade-in space-y-6">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <h3 className="text-lg font-bold text-white mb-6">Testi Pagina Iniziale</h3>
            <div className="space-y-6">
              <div>
                <label className="text-xs text-slate-400 uppercase font-bold mb-2 block">Titolo</label>
                <input
                  className="w-full p-4 bg-slate-900 border border-slate-600 rounded-lg text-white text-xl font-bold"
                  value={homeTitle}
                  onChange={(e) => setHomeTitle(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 uppercase font-bold mb-2 block">Sottotitolo</label>
                <textarea
                  className="w-full p-4 bg-slate-900 border border-slate-600 rounded-lg text-white text-lg h-32 resize-none"
                  value={homeSubtitle}
                  onChange={(e) => setHomeSubtitle(e.target.value)}
                />
              </div>
              <Button onClick={handleUpdateHome} className="w-full">
                Salva
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
