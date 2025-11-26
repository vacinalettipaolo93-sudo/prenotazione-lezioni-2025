import React, { useState, useEffect } from 'react';
import { CalendarEvent, AppConfig, WeeklySchedule, SportLocation, Sport, LessonType, DailySchedule } from '../types';
import { getAllCalendarEvents, connectGoogleCalendar, disconnectGoogleCalendar, isCalendarConnected, initGoogleClient, syncGoogleEventsToFirebase, exportBookingsToGoogle, getBookings, listGoogleCalendars } from '../services/calendarService';
import { getAppConfig, addSport, updateSport, removeSport, addSportLocation, updateSportLocation, removeSportLocation, addSportLessonType, removeSportLessonType, addSportDuration, removeSportDuration, updateHomeConfig, updateMinBookingNotice, initConfigListener, updateImportBusyCalendars, updateLocationException } from '../services/configService';
import { logout } from '../services/authService';
import Button from './Button';

interface AdminDashboardProps {
    onLogout: () => void;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onLogout }) => {
  const [activeTab, setActiveTab] = useState<'calendar' | 'config' | 'schedule' | 'home'>('calendar');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isConnected, setIsConnected] = useState(isCalendarConnected());
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [config, setConfig] = useState<AppConfig>(getAppConfig());
  
  // Calendar State
  const [userCalendars, setUserCalendars] = useState<{id: string, summary: string, primary?: boolean}[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);
  const [loadingCalendars, setLoadingCalendars] = useState(false);

  // --- NEW STATE FOR NESTED CONFIG ---
  const [expandedSportId, setExpandedSportId] = useState<string | null>(null);
  
  // Temp forms for adding nested items
  const [newSportName, setNewSportName] = useState('');
  const [newLocName, setNewLocName] = useState('');
  const [newLocAddr, setNewLocAddr] = useState('');
  const [newLessonType, setNewLessonType] = useState('');
  const [newDuration, setNewDuration] = useState('60');

  // Editing Sport Meta
  const [editingSportId, setEditingSportId] = useState<string | null>(null);
  const [tempSport, setTempSport] = useState<Partial<Sport>>({});

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
  const [exceptionData, setExceptionData] = useState<DailySchedule>({ isOpen: true, start: '09:00', end: '22:00', allowedLessonTypeIds: [] });
  const [currentExceptions, setCurrentExceptions] = useState<Record<string, DailySchedule>>({});

  useEffect(() => {
    const init = async () => {
        await initGoogleClient();
        setIsConnected(isCalendarConnected());
        if (isCalendarConnected()) {
            fetchUserCalendars();
        }
    };
    init();
    
    const unsub = initConfigListener((newConfig) => {
        setConfig(newConfig);
        setHomeTitle(newConfig.homeTitle);
        setHomeSubtitle(newConfig.homeSubtitle);
        setNoticeHours((newConfig.minBookingNoticeMinutes || 0) / 60);
        if (newConfig.importBusyCalendars) {
            setSelectedCalendarIds(newConfig.importBusyCalendars);
        }
    });

    refreshEvents();

    return () => unsub();
  }, []);

  useEffect(() => {
      if (isConnected && userCalendars.length === 0) {
          fetchUserCalendars();
      }
  }, [isConnected]);

  // Auto-select first sport/location for schedule tab
  useEffect(() => {
      if (config.sports.length > 0 && !selectedScheduleSportId) {
          const firstSport = config.sports[0];
          setSelectedScheduleSportId(firstSport.id);
          if (firstSport.locations.length > 0) {
              setSelectedScheduleLocId(firstSport.locations[0].id);
          }
      }
  }, [config.sports, selectedScheduleSportId]);

  // Load schedule when selection changes
  useEffect(() => {
      if (selectedScheduleSportId && selectedScheduleLocId) {
          const sport = config.sports.find(s => s.id === selectedScheduleSportId);
          const loc = sport?.locations.find(l => l.id === selectedScheduleLocId);
          if (loc) {
              setEditingSchedule(loc.schedule);
              setEditingSlotInterval(loc.slotInterval);
              setCurrentExceptions(loc.scheduleExceptions || {});
          } else {
              setEditingSchedule(null);
          }
      }
  }, [selectedScheduleSportId, selectedScheduleLocId, config.sports]);

  const refreshEvents = () => {
    setEvents(getAllCalendarEvents());
    setIsConnected(isCalendarConnected());
  };

  const fetchUserCalendars = async () => {
      setLoadingCalendars(true);
      try {
          const cals = await listGoogleCalendars();
          setUserCalendars(cals);
      } catch (e: any) {
          console.error("Could not list calendars", e);
          if (e.status === 401) setIsConnected(false);
      } finally {
          setLoadingCalendars(false);
      }
  }

  const handleConnectCalendar = async () => {
    setIsConnecting(true);
    try {
        await connectGoogleCalendar();
        setIsConnected(true);
        fetchUserCalendars();
    } catch (e: any) {
        if (e && e.error === 'access_denied') {
            alert("ACCESSO NEGATO: Aggiungi la tua email ai Test Users in Google Cloud Console.");
        } else {
            alert("Errore connessione Google Calendar.");
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
        ? selectedCalendarIds.filter(id => id !== calId)
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
          alert("Errore durante la sincronizzazione.");
      } finally {
          setIsSyncing(false);
      }
  }

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
  }

  // --- SPORT ACTIONS ---
  const handleAddSport = () => {
      if(!newSportName) return;
      addSport(newSportName);
      setNewSportName('');
  };

  const startEditSport = (sport: Sport) => {
      setEditingSportId(sport.id);
      setTempSport({...sport});
  };

  const saveEditSport = () => {
      if (editingSportId && tempSport.name) {
          updateSport(editingSportId, tempSport);
          setEditingSportId(null);
      }
  };

  // --- NESTED ACTIONS ---
  const handleAddLocation = (sportId: string) => {
      if(!newLocName) return;
      addSportLocation(sportId, newLocName, newLocAddr);
      setNewLocName('');
      setNewLocAddr('');
  }

  const handleUpdateLocation = (sportId: string, locId: string, updates: Partial<SportLocation>) => {
      updateSportLocation(sportId, locId, updates);
  }

  const handleUpdateLessonType = (sportId: string, typeId: string, newName: string) => {
     const sport = config.sports.find(s => s.id === sportId);
     if (sport) {
         const newTypes = sport.lessonTypes.map(t => t.id === typeId ? {...t, name: newName} : t);
         updateSport(sportId, { lessonTypes: newTypes });
     }
  }

  const handleAddLessonType = (sportId: string) => {
      if(!newLessonType) return;
      addSportLessonType(sportId, newLessonType);
      setNewLessonType('');
  }

  const handleAddDuration = (sportId: string) => {
      const mins = parseInt(newDuration);
      if(mins > 0) {
        addSportDuration(sportId, mins);
      }
  }

  // --- SCHEDULE ACTIONS ---
  const handleSaveSchedule = () => {
      if (!selectedScheduleSportId || !selectedScheduleLocId || !editingSchedule) return;
      updateSportLocation(selectedScheduleSportId, selectedScheduleLocId, {
          schedule: editingSchedule,
          slotInterval: editingSlotInterval
      });
      alert('Orari aggiornati!');
  }

  const handleScheduleChange = (day: keyof WeeklySchedule, field: 'start' | 'end' | 'isOpen', value: any) => {
      if (!editingSchedule) return;
      setEditingSchedule(prev => {
          if (!prev) return null;
          return {
            ...prev,
            [day]: { ...prev[day], [field]: value }
          };
      });
  };

  const handleLessonTypeToggle = (day: keyof WeeklySchedule, typeId: string) => {
      if (!editingSchedule) return;
      setEditingSchedule(prev => {
          if (!prev) return null;
          const currentTypes = prev[day].allowedLessonTypeIds || [];
          const newTypes = currentTypes.includes(typeId) 
             ? currentTypes.filter(id => id !== typeId)
             : [...currentTypes, typeId];
          
          return {
              ...prev,
              [day]: { ...prev[day], allowedLessonTypeIds: newTypes }
          };
      });
  }
  
  // --- EXCEPTION ACTIONS ---
  const handleSaveException = () => {
      if (!selectedScheduleSportId || !selectedScheduleLocId || !exceptionDate) return;
      updateLocationException(selectedScheduleSportId, selectedScheduleLocId, exceptionDate, exceptionData);
      setExceptionDate(''); // Reset form
  }

  const handleDeleteException = (date: string) => {
      if (!selectedScheduleSportId || !selectedScheduleLocId) return;
      updateLocationException(selectedScheduleSportId, selectedScheduleLocId, date, null);
  }

  const handleUpdateHome = () => {
      updateHomeConfig(homeTitle, homeSubtitle);
      alert('Home aggiornata!');
  }

  const handleUpdateNotice = () => {
      updateMinBookingNotice(noticeHours * 60);
      alert('Preavviso aggiornato!');
  }

  const handleLogout = () => {
      logout();
      onLogout();
  };

  const dayLabels: Record<string, string> = {
      monday: 'Lunedì', tuesday: 'Martedì', wednesday: 'Mercoledì', 
      thursday: 'Giovedì', friday: 'Venerdì', saturday: 'Sabato', sunday: 'Domenica'
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
            <div className="flex bg-slate-800 p-1 rounded-xl border border-slate-700">
                <button onClick={() => setActiveTab('calendar')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'calendar' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}>Calendario</button>
                <button onClick={() => setActiveTab('config')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'config' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}>Offerta</button>
                <button onClick={() => setActiveTab('schedule')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'schedule' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}>Orari</button>
                <button onClick={() => setActiveTab('home')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'home' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}>Home</button>
            </div>
            <Button variant="outline" onClick={handleLogout} className="ml-2 border-red-900/50 text-red-400 hover:bg-red-900/20 hover:border-red-500/50">Esci</Button>
        </div>
      </div>

      {/* TAB: CALENDAR */}
      {activeTab === 'calendar' && (
          <div className="space-y-8 animate-in fade-in">
             <div className={`p-6 rounded-xl border ${isConnected ? 'bg-emerald-900/10 border-emerald-500/30' : 'bg-slate-800 border-slate-700'}`}>
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isConnected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-500'}`}>📅</div>
                        <div>
                            <h3 className="font-bold text-lg text-white">Google Calendar</h3>
                            <p className="text-sm text-slate-400 flex items-center gap-2">
                                {isConnected ? "Connesso" : "Disconnesso"}
                                {isConnected && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 animate-pulse">Auto-Sync Attivo</span>}
                            </p>
                        </div>
                    </div>
                    {!isConnected ? (
                        <Button onClick={handleConnectCalendar} isLoading={isConnecting}>Connetti</Button>
                    ) : (
                        <div className="flex gap-2">
                             <Button onClick={handleSyncNow} isLoading={isSyncing} variant="secondary">Sync Forzato</Button>
                             <Button onClick={handleExportToGoogle} isLoading={isExporting} variant="primary">Esporta Nuovi</Button>
                        </div>
                    )}
                </div>
             </div>
             
             {isConnected && (
                 <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
                     <div className="flex justify-between items-center mb-4">
                         <h3 className="font-bold text-white">Calendari "Occupati" (Import)</h3>
                         <button onClick={fetchUserCalendars} disabled={loadingCalendars} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
                             <svg className={`w-4 h-4 ${loadingCalendars ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                             Aggiorna Lista
                         </button>
                     </div>
                     
                     {loadingCalendars ? <p className="text-slate-400">Caricamento calendari...</p> : (
                        userCalendars.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-h-40 overflow-y-auto">
                                {userCalendars.map(cal => (
                                    <label key={cal.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${selectedCalendarIds.includes(cal.id) ? 'bg-indigo-900/20 border-indigo-500/50' : 'bg-slate-900 border-slate-700 hover:border-slate-600'}`}>
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
                                <Button onClick={handleConnectCalendar} variant="ghost" className="text-xs">Riconnetti Account</Button>
                            </div>
                        )
                     )}
                 </div>
             )}
          </div>
      )}

      {/* TAB: CONFIG */}
      {activeTab === 'config' && (
        <div className="animate-in fade-in space-y-8">
             {/* Global Settings */}
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
                        onChange={e => setNoticeHours(Number(e.target.value))} 
                    />
                    <Button onClick={handleUpdateNotice} className="text-xs">Salva</Button>
                </div>
             </div>

             {/* Sports List */}
             <div className="space-y-4">
                 <h3 className="text-xl font-bold text-white">Configurazione Sport</h3>
                 {config.sports.map(sport => (
                     <div key={sport.id} className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                         {/* Sport Header */}
                         <div className="p-4 bg-slate-800 flex items-center justify-between cursor-pointer hover:bg-slate-750" onClick={() => setExpandedSportId(expandedSportId === sport.id ? null : sport.id)}>
                             <div className="flex items-center gap-4">
                                 <div className="text-2xl">{sport.emoji}</div>
                                 {editingSportId === sport.id ? (
                                     <input 
                                        className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white"
                                        value={tempSport.name}
                                        onClick={e => e.stopPropagation()}
                                        onChange={e => setTempSport({...tempSport, name: e.target.value})}
                                     />
                                 ) : (
                                     <h4 className="text-lg font-bold text-white">{sport.name}</h4>
                                 )}
                             </div>
                             <div className="flex items-center gap-2">
                                 {editingSportId === sport.id ? (
                                     <Button onClick={(e) => { e.stopPropagation(); saveEditSport(); }} className="text-xs py-1">Salva</Button>
                                 ) : (
                                    <button onClick={(e) => { e.stopPropagation(); startEditSport(sport); }} className="text-xs text-slate-400 hover:text-white">Modifica Nome</button>
                                 )}
                                 <button onClick={(e) => { e.stopPropagation(); removeSport(sport.id); }} className="text-xs text-red-400 hover:text-red-300 ml-2">Elimina</button>
                                 <div className={`transform transition-transform ${expandedSportId === sport.id ? 'rotate-180' : ''}`}>▼</div>
                             </div>
                         </div>
                         {/* Nested Configuration Body */}
                         {expandedSportId === sport.id && (
                             <div className="p-6 bg-slate-900/50 border-t border-slate-700 grid grid-cols-1 md:grid-cols-3 gap-6">
                                 <div className="space-y-3">
                                     <h5 className="text-sm font-bold text-indigo-400 uppercase tracking-wider">Sedi & Calendari</h5>
                                     {sport.locations.map(loc => (
                                         <div key={loc.id} className="bg-slate-800 p-3 rounded border border-slate-700 text-sm space-y-2">
                                             <div className="flex justify-between items-center">
                                                 <input 
                                                    className="bg-transparent border-b border-transparent hover:border-slate-600 focus:border-indigo-500 focus:outline-none font-bold text-white w-full"
                                                    value={loc.name}
                                                    onChange={(e) => handleUpdateLocation(sport.id, loc.id, {name: e.target.value})}
                                                 />
                                                 <button onClick={() => removeSportLocation(sport.id, loc.id)} className="text-red-400 hover:text-white ml-2">×</button>
                                             </div>
                                             
                                             <input 
                                                className="bg-transparent border-b border-transparent hover:border-slate-600 focus:border-indigo-500 focus:outline-none text-slate-400 text-xs w-full"
                                                value={loc.address}
                                                onChange={(e) => handleUpdateLocation(sport.id, loc.id, {address: e.target.value})}
                                             />
                                             
                                             <select 
                                                className="w-full bg-slate-900 border border-slate-600 rounded text-xs text-slate-300 p-1 mt-2"
                                                value={loc.googleCalendarId || ''}
                                                onChange={(e) => handleUpdateLocation(sport.id, loc.id, { googleCalendarId: e.target.value })}
                                             >
                                                 <option value="">-- Calendario Default --</option>
                                                 {userCalendars.map(c => (
                                                     <option key={c.id} value={c.id}>{c.summary}</option>
                                                 ))}
                                             </select>
                                         </div>
                                     ))}
                                     <div className="bg-slate-800/50 p-2 rounded border border-slate-700/50 space-y-2">
                                         <input placeholder="Nome Sede" className="w-full bg-transparent border-b border-slate-600 text-xs p-1 text-white" value={newLocName} onChange={e => setNewLocName(e.target.value)} />
                                         <input placeholder="Indirizzo" className="w-full bg-transparent border-b border-slate-600 text-xs p-1 text-white" value={newLocAddr} onChange={e => setNewLocAddr(e.target.value)} />
                                         <button onClick={() => handleAddLocation(sport.id)} className="w-full bg-slate-700 hover:bg-slate-600 text-xs text-white py-1 rounded">Aggiungi Sede</button>
                                     </div>
                                 </div>
                                 <div className="space-y-3">
                                     <h5 className="text-sm font-bold text-indigo-400 uppercase tracking-wider">Tipi Lezione</h5>
                                     {sport.lessonTypes.map(lt => (
                                         <div key={lt.id} className="bg-slate-800 p-2 rounded border border-slate-700 flex justify-between items-center text-sm text-white">
                                             <input 
                                                className="bg-transparent border-b border-transparent hover:border-slate-600 focus:border-indigo-500 focus:outline-none text-white w-full mr-2"
                                                value={lt.name}
                                                onChange={(e) => handleUpdateLessonType(sport.id, lt.id, e.target.value)}
                                             />
                                             <button onClick={() => removeSportLessonType(sport.id, lt.id)} className="text-red-400 hover:text-white">×</button>
                                         </div>
                                     ))}
                                     <div className="flex gap-2">
                                         <input placeholder="Es. Singola" className="flex-1 bg-slate-800 border border-slate-600 text-xs p-1 rounded text-white" value={newLessonType} onChange={e => setNewLessonType(e.target.value)} />
                                         <button onClick={() => handleAddLessonType(sport.id)} className="bg-slate-700 hover:bg-slate-600 text-xs text-white px-2 rounded">+</button>
                                     </div>
                                 </div>
                                 <div className="space-y-3">
                                     <h5 className="text-sm font-bold text-indigo-400 uppercase tracking-wider">Durate (min)</h5>
                                     <div className="flex flex-wrap gap-2">
                                         {sport.durations.map(d => (
                                             <div key={d} className="bg-slate-800 px-2 py-1 rounded border border-slate-700 flex items-center gap-2 text-sm text-white">
                                                 {d}m
                                                 <button onClick={() => removeSportDuration(sport.id, d)} className="text-slate-500 hover:text-red-400">×</button>
                                             </div>
                                         ))}
                                     </div>
                                     <div className="flex gap-2">
                                         <input type="number" placeholder="60" className="w-16 bg-slate-800 border border-slate-600 text-xs p-1 rounded text-white" value={newDuration} onChange={e => setNewDuration(e.target.value)} />
                                         <button onClick={() => handleAddDuration(sport.id)} className="bg-slate-700 hover:bg-slate-600 text-xs text-white px-2 rounded">+</button>
                                     </div>
                                 </div>
                             </div>
                         )}
                     </div>
                 ))}
                 <div className="flex gap-2 max-w-md mt-6">
                     <input 
                        className="flex-1 p-2 bg-slate-900 border border-slate-600 rounded-lg text-white"
                        placeholder="Nuovo Sport (es. Pickleball)"
                        value={newSportName}
                        onChange={e => setNewSportName(e.target.value)}
                     />
                     <Button onClick={handleAddSport}>Aggiungi Sport</Button>
                 </div>
             </div>
        </div>
      )}

      {/* TAB: SCHEDULE */}
      {activeTab === 'schedule' && (
          <div className="max-w-4xl mx-auto animate-in fade-in space-y-6">
               
               {/* 1. SELEZIONE SEDE */}
               <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6 flex flex-col md:flex-row justify-between items-center gap-4">
                   <div>
                       <h2 className="text-xl font-bold text-white">Configura Orari</h2>
                       <p className="text-sm text-slate-400">Gestisci orari standard e eccezioni per data.</p>
                   </div>
                   <div className="flex gap-2">
                       <select 
                            className="p-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm"
                            value={selectedScheduleSportId}
                            onChange={(e) => {
                                const newSportId = e.target.value;
                                setSelectedScheduleSportId(newSportId);
                                const sport = config.sports.find(s => s.id === newSportId);
                                if(sport && sport.locations.length > 0) {
                                    setSelectedScheduleLocId(sport.locations[0].id);
                                } else {
                                    setSelectedScheduleLocId('');
                                }
                            }}
                        >
                            <option value="" disabled>Seleziona Sport</option>
                            {config.sports.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        <select 
                            className="p-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm"
                            value={selectedScheduleLocId}
                            onChange={(e) => setSelectedScheduleLocId(e.target.value)}
                            disabled={!selectedScheduleSportId}
                        >
                            <option value="" disabled>Seleziona Sede</option>
                            {config.sports.find(s => s.id === selectedScheduleSportId)?.locations.map(l => (
                                <option key={l.id} value={l.id}>{l.name}</option>
                            ))}
                        </select>
                   </div>
               </div>

               {editingSchedule ? (
                <>
                    {/* 2. ORARIO SETTIMANALE STANDARD */}
                    <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
                        <div className="p-4 bg-slate-800/80 border-b border-slate-700 flex justify-between items-center">
                            <h3 className="font-bold text-white">Orario Settimanale Standard</h3>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-400 uppercase">Intervallo</span>
                                <div className="flex items-center gap-1 bg-slate-900 p-1 rounded border border-slate-700">
                                    <button onClick={() => setEditingSlotInterval(60)} className={`px-2 py-0.5 rounded text-xs font-bold ${editingSlotInterval === 60 ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>60m</button>
                                    <button onClick={() => setEditingSlotInterval(30)} className={`px-2 py-0.5 rounded text-xs font-bold ${editingSlotInterval === 30 ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>30m</button>
                                </div>
                            </div>
                        </div>

                        <div className="p-4 space-y-1">
                            {Object.keys(editingSchedule).map((dayKey) => {
                                const day = dayKey as keyof WeeklySchedule;
                                const dayData = editingSchedule[day];
                                return (
                                    <div key={day} className={`p-3 rounded-lg border transition-all ${dayData.isOpen ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-900/30 border-transparent opacity-60'}`}>
                                        <div className="flex flex-wrap items-center gap-4 mb-2">
                                            <div className="w-32 font-medium text-slate-200 capitalize flex items-center gap-2">
                                                <input type="checkbox" checked={dayData.isOpen} onChange={(e) => handleScheduleChange(day, 'isOpen', e.target.checked)} className="w-4 h-4 rounded bg-slate-700 border-slate-600" />
                                                {dayLabels[day]}
                                            </div>
                                            {dayData.isOpen && (
                                                <div className="flex items-center gap-2">
                                                    <input type="time" value={dayData.start} onChange={(e) => handleScheduleChange(day, 'start', e.target.value)} className="bg-slate-900 border border-slate-600 text-white text-sm rounded px-2 py-1" />
                                                    <span className="text-slate-500">-</span>
                                                    <input type="time" value={dayData.end} onChange={(e) => handleScheduleChange(day, 'end', e.target.value)} className="bg-slate-900 border border-slate-600 text-white text-sm rounded px-2 py-1" />
                                                </div>
                                            )}
                                        </div>
                                        {dayData.isOpen && (
                                            <div className="flex flex-wrap gap-2 pl-6">
                                                {config.sports.find(s => s.id === selectedScheduleSportId)?.lessonTypes.map(lt => (
                                                    <label key={lt.id} className="flex items-center gap-1 text-xs text-slate-300 bg-slate-900/50 px-2 py-1 rounded border border-slate-700/50 cursor-pointer hover:bg-slate-800">
                                                        <input 
                                                            type="checkbox" 
                                                            checked={!dayData.allowedLessonTypeIds || dayData.allowedLessonTypeIds.length === 0 || dayData.allowedLessonTypeIds.includes(lt.id)}
                                                            onChange={() => handleLessonTypeToggle(day, lt.id)}
                                                            className="rounded border-slate-600"
                                                        />
                                                        {lt.name}
                                                    </label>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        <div className="p-4 bg-slate-800/50 border-t border-slate-700 flex justify-end">
                            <Button onClick={handleSaveSchedule} className="text-sm">Salva Orario Settimanale</Button>
                        </div>
                    </div>

                    {/* 3. ECCEZIONI / DATE SPECIFICHE */}
                    <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
                        <div className="p-4 bg-slate-800/80 border-b border-slate-700">
                            <h3 className="font-bold text-white">Date Specifiche / Eccezioni</h3>
                            <p className="text-xs text-slate-400">Aggiungi regole speciali per giorni specifici (es. aperture straordinarie, chiusure).</p>
                        </div>
                        
                        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                            {/* Form Aggiunta */}
                            <div className="space-y-4">
                                <label className="block text-xs font-bold uppercase text-slate-500">Aggiungi Eccezione</label>
                                <input 
                                    type="date" 
                                    className="w-full p-2 bg-slate-900 border border-slate-600 rounded text-white"
                                    value={exceptionDate}
                                    onChange={(e) => setExceptionDate(e.target.value)}
                                />
                                <div className="flex items-center gap-2 p-3 bg-slate-900 rounded border border-slate-700">
                                    <input 
                                        type="checkbox" 
                                        checked={exceptionData.isOpen} 
                                        onChange={(e) => setExceptionData({...exceptionData, isOpen: e.target.checked})}
                                        className="w-5 h-5 rounded bg-slate-700 border-slate-600"
                                    />
                                    <span className={exceptionData.isOpen ? "text-white font-bold" : "text-slate-500"}>
                                        {exceptionData.isOpen ? "APERTO" : "CHIUSO"}
                                    </span>
                                </div>
                                {exceptionData.isOpen && (
                                    <div className="flex gap-2">
                                        <div className="flex-1">
                                            <label className="text-xs text-slate-500 block mb-1">Apertura</label>
                                            <input type="time" value={exceptionData.start} onChange={e => setExceptionData({...exceptionData, start: e.target.value})} className="w-full bg-slate-900 border border-slate-600 text-white rounded p-2" />
                                        </div>
                                        <div className="flex-1">
                                            <label className="text-xs text-slate-500 block mb-1">Chiusura</label>
                                            <input type="time" value={exceptionData.end} onChange={e => setExceptionData({...exceptionData, end: e.target.value})} className="w-full bg-slate-900 border border-slate-600 text-white rounded p-2" />
                                        </div>
                                    </div>
                                )}
                                <Button onClick={handleSaveException} disabled={!exceptionDate} className="w-full text-sm">Salva Eccezione</Button>
                            </div>

                            {/* Lista Eccezioni Esistenti */}
                            <div className="border-l border-slate-700 pl-8 space-y-3 max-h-80 overflow-y-auto">
                                <label className="block text-xs font-bold uppercase text-slate-500 sticky top-0 bg-slate-800 py-1">Eccezioni Attive</label>
                                {Object.keys(currentExceptions).length === 0 ? (
                                    <p className="text-sm text-slate-500 italic">Nessuna eccezione configurata.</p>
                                ) : (
                                    Object.entries(currentExceptions).sort().map(([date, data]: [string, DailySchedule]) => (
                                        <div key={date} className="flex justify-between items-center bg-slate-900 p-3 rounded border border-slate-700">
                                            <div>
                                                <div className="font-bold text-white text-sm">{new Date(date).toLocaleDateString('it-IT')}</div>
                                                <div className="text-xs text-slate-400">
                                                    {data.isOpen ? `${data.start} - ${data.end}` : <span className="text-red-400">CHIUSO</span>}
                                                </div>
                                            </div>
                                            <button onClick={() => handleDeleteException(date)} className="text-red-400 hover:text-white text-xs px-2 py-1 rounded bg-slate-800 border border-slate-600">
                                                Elimina
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </>
               ) : (
                   <div className="p-10 text-center text-slate-500 bg-slate-800/30 rounded-xl border border-slate-800">Seleziona uno sport e una sede per configurare gli orari.</div>
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
                            <input className="w-full p-4 bg-slate-900 border border-slate-600 rounded-lg text-white text-xl font-bold" value={homeTitle} onChange={e => setHomeTitle(e.target.value)} />
                        </div>
                        <div>
                            <label className="text-xs text-slate-400 uppercase font-bold mb-2 block">Sottotitolo</label>
                            <textarea className="w-full p-4 bg-slate-900 border border-slate-600 rounded-lg text-white text-lg h-32 resize-none" value={homeSubtitle} onChange={e => setHomeSubtitle(e.target.value)} />
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