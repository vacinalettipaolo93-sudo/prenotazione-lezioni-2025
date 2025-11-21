
import React, { useState, useEffect } from 'react';
import { CalendarEvent, AppConfig, WeeklySchedule, Location, Sport } from '../types';
import { getAllCalendarEvents, connectGoogleCalendar, disconnectGoogleCalendar, isCalendarConnected, initGoogleClient, syncGoogleEventsToFirebase, exportBookingsToGoogle, getBookings } from '../services/calendarService';
import { getAppConfig, addSport, updateSport, removeSport, addLocation, updateLocationDetails, removeLocation, addDuration, removeDuration, updateHomeConfig, updateLocationSchedule, updateMinBookingNotice, initConfigListener } from '../services/configService';
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
  const [publicLinkCopied, setPublicLinkCopied] = useState(false);

  // --- EDITING STATES ---
  const [editingSportId, setEditingSportId] = useState<string | null>(null);
  const [tempSport, setTempSport] = useState<Partial<Sport>>({});

  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [tempLocation, setTempLocation] = useState<Partial<Location>>({});

  // Config Forms
  const [newSportName, setNewSportName] = useState('');
  const [newLocationName, setNewLocationName] = useState('');
  const [newLocationAddr, setNewLocationAddr] = useState('');
  const [newDuration, setNewDuration] = useState('60');
  const [noticeHours, setNoticeHours] = useState<number>(0);

  // Home Config Form
  const [homeTitle, setHomeTitle] = useState('');
  const [homeSubtitle, setHomeSubtitle] = useState('');

  // Schedule Config State
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [schedule, setSchedule] = useState<WeeklySchedule | null>(null);
  const [slotInterval, setSlotInterval] = useState<30 | 60>(60);

  useEffect(() => {
    initGoogleClient();
    
    const unsub = initConfigListener((newConfig) => {
        setConfig(newConfig);
        setHomeTitle(newConfig.homeTitle);
        setHomeSubtitle(newConfig.homeSubtitle);
        setNoticeHours((newConfig.minBookingNoticeMinutes || 0) / 60);
    });

    refreshEvents();

    return () => unsub();
  }, []);

  useEffect(() => {
      if (config.locations.length > 0 && !selectedLocationId) {
          setSelectedLocationId(config.locations[0].id);
      }
  }, [config.locations, selectedLocationId]);

  useEffect(() => {
      if (selectedLocationId) {
          const loc = config.locations.find(l => l.id === selectedLocationId);
          if (loc) {
              setSchedule(loc.schedule);
              setSlotInterval(loc.slotInterval);
          }
      }
  }, [selectedLocationId, config.locations]);

  const refreshEvents = () => {
    setEvents(getAllCalendarEvents());
    setIsConnected(isCalendarConnected());
  };

  const handleConnectCalendar = async () => {
    setIsConnecting(true);
    try {
        await connectGoogleCalendar();
        setIsConnected(true);
    } catch (e) {
        console.error(e);
        alert("Errore connessione Google Calendar. Controlla console.");
    } finally {
        setIsConnecting(false);
        refreshEvents();
    }
  };

  const handleDisconnect = () => {
    disconnectGoogleCalendar();
    setIsConnected(false);
    refreshEvents();
  };

  const handleSyncNow = async () => {
      if (!isConnected) return;
      setIsSyncing(true);
      try {
          const calendarId = config.locations[0]?.googleCalendarId || 'primary';
          const count = await syncGoogleEventsToFirebase(calendarId);
          alert(`Sincronizzazione da Google completata! ${count} eventi importati.`);
          refreshEvents();
      } catch (e) {
          alert("Errore durante la sincronizzazione. Assicurati di essere loggato.");
      } finally {
          setIsSyncing(false);
      }
  }

  const handleExportToGoogle = async () => {
      if (!isConnected) return;
      setIsExporting(true);
      try {
          const count = await exportBookingsToGoogle('primary');
          if (count > 0) {
              alert(`Successo! ${count} nuove prenotazioni esportate sul tuo Google Calendar.`);
          } else {
              alert("Nessuna nuova prenotazione da esportare (tutte già sincronizzate).");
          }
          refreshEvents();
      } catch (e) {
          console.error(e);
          alert("Errore durante l'esportazione. Verifica la connessione.");
      } finally {
          setIsExporting(false);
      }
  }

  // --- SPORT ACTIONS ---
  const handleAddSport = (e: React.MouseEvent) => {
      e.preventDefault();
      if(!newSportName) return;
      addSport({ 
          id: Date.now().toString(), 
          name: newSportName, 
          emoji: '', 
          description: 'Nuova attività' 
      });
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

  // --- LOCATION ACTIONS ---
  const handleAddLocation = (e: React.MouseEvent) => {
      e.preventDefault();
      if(!newLocationName) return;
      addLocation({ id: Date.now().toString(), name: newLocationName, address: newLocationAddr });
      setNewLocationName('');
      setNewLocationAddr('');
  };

  const startEditLocation = (loc: Location) => {
      setEditingLocationId(loc.id);
      setTempLocation({...loc});
  };

  const saveEditLocation = () => {
      if (editingLocationId && tempLocation.name) {
          updateLocationDetails(editingLocationId, tempLocation);
          setEditingLocationId(null);
      }
  };

  const handleAddDuration = (e: React.MouseEvent) => {
      e.preventDefault();
      const mins = parseInt(newDuration);
      if(mins > 0) {
          addDuration({ minutes: mins, label: `${mins} Minuti` });
      }
  };

  const handleUpdateHome = () => {
      updateHomeConfig(homeTitle, homeSubtitle);
      alert('Home aggiornata con successo!');
  }

  const handleUpdateNotice = () => {
      updateMinBookingNotice(noticeHours * 60);
      alert('Preavviso minimo aggiornato!');
  }

  const handleSaveSchedule = () => {
      if (!selectedLocationId || !schedule) return;
      updateLocationSchedule(selectedLocationId, schedule, slotInterval);
      alert('Orari aggiornati per la sede selezionata!');
  }

  const handleScheduleChange = (day: keyof WeeklySchedule, field: 'start' | 'end' | 'isOpen', value: any) => {
      if (!schedule) return;
      setSchedule(prev => {
          if (!prev) return null;
          return {
            ...prev,
            [day]: {
                ...prev[day],
                [field]: value
            }
          };
      });
  };

  const handleResetConfig = () => {
      if(confirm("Sei sicuro? Questo ripristinerà tutto alle impostazioni iniziali.")) {
        localStorage.removeItem('courtmaster_config_v3');
        window.location.reload();
      }
  };

  const handleLogout = () => {
      logout();
      onLogout();
  };

  const handleCopyLink = () => {
      const url = window.location.origin; 
      navigator.clipboard.writeText(url);
      setPublicLinkCopied(true);
      setTimeout(() => setPublicLinkCopied(false), 2000);
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
                <button 
                    onClick={() => setActiveTab('calendar')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'calendar' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
                >
                    Calendario
                </button>
                <button 
                    onClick={() => setActiveTab('schedule')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'schedule' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
                >
                    Orari
                </button>
                <button 
                    onClick={() => setActiveTab('config')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'config' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
                >
                    Offerta
                </button>
                 <button 
                    onClick={() => setActiveTab('home')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'home' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
                >
                    Home
                </button>
            </div>
            <Button variant="outline" onClick={handleLogout} className="ml-2 border-red-900/50 text-red-400 hover:bg-red-900/20 hover:border-red-500/50">
                Esci
            </Button>
        </div>
      </div>

      {/* Share Link Box */}
      <div className="mb-8 bg-gradient-to-r from-indigo-900/20 to-violet-900/20 border border-indigo-500/30 rounded-xl p-5 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
              <div className="bg-indigo-500/20 p-3 rounded-full text-indigo-400">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>
              </div>
              <div>
                  <h3 className="font-bold text-white">Il tuo Link Pubblico</h3>
                  <p className="text-xs text-slate-400">I clienti usano questo link per prenotare.</p>
              </div>
          </div>
          <div className="flex items-center gap-2 w-full md:w-auto bg-slate-900 px-4 py-2 rounded-lg border border-slate-700">
              <code className="text-sm text-slate-300 truncate max-w-[200px] md:max-w-xs">{window.location.origin}</code>
              <button onClick={handleCopyLink} className="text-xs font-bold text-indigo-400 hover:text-indigo-300 uppercase ml-2 tracking-wider">
                  {publicLinkCopied ? 'Copiato!' : 'Copia'}
              </button>
          </div>
      </div>

      {/* TAB: CALENDAR */}
      {activeTab === 'calendar' && (
          <div className="space-y-8 animate-in fade-in">
            <div className={`p-6 rounded-xl border ${isConnected ? 'bg-emerald-900/10 border-emerald-500/30' : 'bg-slate-800 border-slate-700'}`}>
                <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isConnected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-500'}`}>
                            <svg className="w-6 h-6" viewBox="0 0 24 24"><path fill="currentColor" d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2zm-7 5h5v5h-5v-5z"/></svg>
                        </div>
                        <div>
                            <h3 className="font-bold text-lg text-white">Google Calendar</h3>
                            <p className="text-sm text-slate-400">
                                {isConnected 
                                    ? "Connesso e operativo." 
                                    : "Connetti per abilitare la sincronizzazione."}
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2 justify-center md:justify-end">
                        {!isConnected ? (
                             <Button onClick={handleConnectCalendar} isLoading={isConnecting} variant="outline">
                                 Connetti Account Google
                             </Button>
                        ) : (
                            <>
                             <Button onClick={handleSyncNow} isLoading={isSyncing} variant="secondary" className="text-sm">
                                 1. Scarica Impegni
                             </Button>
                             <Button onClick={handleExportToGoogle} isLoading={isExporting} variant="primary" className="text-sm">
                                 2. Esporta Prenotazioni
                             </Button>
                             <Button onClick={handleDisconnect} variant="ghost" className="text-red-400 hover:bg-red-900/20">
                                 Disconnetti
                             </Button>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {isConnected && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
                        <div className="px-6 py-4 bg-slate-800 border-b border-slate-700 font-semibold text-slate-200 flex justify-between items-center">
                            <span>Prossimi Eventi</span>
                        </div>
                        {events.length === 0 ? (
                             <div className="p-8 text-center text-slate-500">Nessun evento in programma.</div>
                        ) : (
                            <ul className="divide-y divide-slate-700 max-h-[400px] overflow-y-auto">
                                {events.map(ev => (
                                    <li key={ev.id} className="p-4 flex items-center gap-4 hover:bg-slate-800/50 transition-colors">
                                        <div className={`w-1 h-10 rounded-full ${ev.type === 'APP_BOOKING' ? 'bg-indigo-500' : 'bg-emerald-500'}`}></div>
                                        <div className="flex-1">
                                            <div className="flex justify-between items-start">
                                                <div className="font-bold text-slate-200">{ev.title}</div>
                                                {ev.type === 'APP_BOOKING' && (
                                                     <span className="text-[10px] bg-slate-700 px-1 rounded text-slate-400">
                                                        {getBookings().find(b => b.id === ev.id)?.googleEventId ? '✓ Su Google' : 'In attesa Export'}
                                                     </span>
                                                )}
                                            </div>
                                            <div className="text-xs text-slate-500">
                                                {new Date(ev.start).toLocaleString('it-IT')}
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-6">
                        <h3 className="font-bold text-slate-300 mb-2">Stato Sincronizzazione</h3>
                        <div className="text-sm text-slate-400 space-y-2">
                            <p>Assicurati di cliccare "Scarica Impegni" per bloccare gli slot occupati sul tuo calendario.</p>
                            <p>Clicca "Esporta" per inviare le nuove lezioni al tuo Google Calendar.</p>
                        </div>
                    </div>
                </div>
            )}
          </div>
      )}

      {/* TAB: SCHEDULE */}
      {activeTab === 'schedule' && (
          <div className="animate-in fade-in max-w-4xl mx-auto">
               <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden mb-6">
                   <div className="p-6 border-b border-slate-700 bg-slate-800/80 flex flex-col md:flex-row justify-between items-center gap-4">
                       <div>
                           <h2 className="text-xl font-bold text-white">Orari Sedi</h2>
                           <p className="text-sm text-slate-400">Seleziona una sede per modificare i suoi orari.</p>
                       </div>

                        <select 
                            className="p-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm min-w-[200px]"
                            value={selectedLocationId}
                            onChange={(e) => setSelectedLocationId(e.target.value)}
                        >
                            {config.locations.map(loc => (
                                <option key={loc.id} value={loc.id}>{loc.name}</option>
                            ))}
                        </select>
                   </div>

                   {schedule && (
                    <>
                        <div className="p-6 bg-slate-800/30 border-b border-slate-700 flex justify-between items-center">
                            <span className="text-sm text-slate-300 font-medium">Intervallo Slot</span>
                            <div className="flex items-center gap-3 bg-slate-900 p-2 rounded-lg border border-slate-700">
                                <button 
                                    onClick={() => setSlotInterval(60)}
                                    className={`px-3 py-1 rounded text-xs font-bold transition-all ${slotInterval === 60 ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-white'}`}
                                >
                                    60 min
                                </button>
                                <button 
                                    onClick={() => setSlotInterval(30)}
                                    className={`px-3 py-1 rounded text-xs font-bold transition-all ${slotInterval === 30 ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-white'}`}
                                >
                                    30 min
                                </button>
                            </div>
                        </div>

                        <div className="p-6 space-y-1">
                            {Object.keys(schedule).map((dayKey) => {
                                const day = dayKey as keyof WeeklySchedule;
                                const dayData = schedule[day];
                                return (
                                    <div key={day} className={`grid grid-cols-12 items-center gap-4 p-3 rounded-lg border transition-all ${dayData.isOpen ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-900/30 border-transparent opacity-60'}`}>
                                        <div className="col-span-3 font-medium text-slate-200 capitalize flex items-center gap-2">
                                            <input 
                                                type="checkbox" 
                                                checked={dayData.isOpen} 
                                                onChange={(e) => handleScheduleChange(day, 'isOpen', e.target.checked)}
                                                className="w-4 h-4 rounded border-slate-600 text-indigo-600 focus:ring-indigo-500 bg-slate-700"
                                            />
                                            {dayLabels[day]}
                                        </div>
                                        
                                        {dayData.isOpen ? (
                                            <>
                                                <div className="col-span-4 flex items-center gap-2">
                                                    <span className="text-xs text-slate-500">Dalle:</span>
                                                    <input 
                                                        type="time" 
                                                        value={dayData.start} 
                                                        onChange={(e) => handleScheduleChange(day, 'start', e.target.value)}
                                                        className="bg-slate-900 border border-slate-600 text-white text-sm rounded px-2 py-1 outline-none focus:border-indigo-500"
                                                    />
                                                </div>
                                                <div className="col-span-4 flex items-center gap-2">
                                                    <span className="text-xs text-slate-500">Alle:</span>
                                                    <input 
                                                        type="time" 
                                                        value={dayData.end} 
                                                        onChange={(e) => handleScheduleChange(day, 'end', e.target.value)}
                                                        className="bg-slate-900 border border-slate-600 text-white text-sm rounded px-2 py-1 outline-none focus:border-indigo-500"
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
                   )}
               </div>
          </div>
      )}

      {/* TAB: CONFIG (SPORTS & LOCATIONS) */}
      {activeTab === 'config' && (
        <div className="animate-in fade-in space-y-8">
            
             {/* Booking Rules */}
             <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
                <h3 className="text-lg font-bold text-white mb-2">Regole Prenotazione</h3>
                <p className="text-sm text-slate-400 mb-4">Imposta le restrizioni per i clienti.</p>
                <div className="flex items-end gap-4">
                    <div className="flex-1">
                         <label className="text-xs text-slate-400 uppercase font-bold mb-1 block">Preavviso Minimo (Ore)</label>
                         <input 
                             type="number" 
                             className="w-full p-3 bg-slate-900 border border-slate-600 rounded-lg text-white"
                             value={noticeHours} 
                             onChange={e => setNoticeHours(Number(e.target.value))} 
                         />
                         <p className="text-xs text-slate-500 mt-1">Esempio: Se imposti 5 ore, alle 10:00 saranno prenotabili solo slot dopo le 15:00.</p>
                    </div>
                    <Button onClick={handleUpdateNotice}>Salva Regola</Button>
                </div>
             </div>

            {/* Sports Management */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
                <h3 className="text-lg font-bold text-white mb-2">Sport</h3>
                <p className="text-sm text-slate-400 mb-6">Gestisci le attività prenotabili. Clicca Modifica per cambiare nome o descrizione.</p>
                
                <div className="space-y-3 mb-6">
                    {config.sports.map(sport => (
                        <div key={sport.id} className="bg-slate-900/50 p-4 rounded-lg border border-slate-700 flex items-center justify-between gap-4">
                            {editingSportId === sport.id ? (
                                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <input 
                                        className="p-2 bg-slate-800 border border-slate-600 rounded text-white text-sm"
                                        value={tempSport.name || ''} 
                                        onChange={e => setTempSport({...tempSport, name: e.target.value})} 
                                        placeholder="Nome Sport"
                                    />
                                    <input 
                                        className="p-2 bg-slate-800 border border-slate-600 rounded text-white text-sm"
                                        value={tempSport.description || ''} 
                                        onChange={e => setTempSport({...tempSport, description: e.target.value})} 
                                        placeholder="Descrizione breve"
                                    />
                                    <div className="flex gap-2 md:col-span-2 justify-end">
                                        <Button size="sm" onClick={saveEditSport} className="text-xs py-1 px-3">Salva</Button>
                                        <button onClick={() => setEditingSportId(null)} className="text-slate-400 text-xs hover:text-white">Annulla</button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-indigo-500/30 flex items-center justify-center">
                                           <div className="w-3 h-3 bg-indigo-500 rounded-full"></div>
                                        </div>
                                        <div>
                                            <div className="font-bold text-white text-lg">{sport.name}</div>
                                            <div className="text-sm text-slate-400">{sport.description}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => startEditSport(sport)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors">
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                                        </button>
                                        <button onClick={() => removeSport(sport.id)} className="p-2 hover:bg-red-900/20 rounded-lg text-slate-400 hover:text-red-400 transition-colors">
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    ))}
                </div>
                
                <div className="flex items-center gap-3 p-4 bg-slate-900/30 rounded-lg border border-slate-700/50">
                     <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-500">
                        +
                     </div>
                     <input 
                        type="text" 
                        value={newSportName}
                        onChange={e => setNewSportName(e.target.value)}
                        placeholder="Nome (es. Pickleball)"
                        className="flex-1 bg-transparent border-b border-slate-700 focus:border-indigo-500 outline-none text-white py-2 transition-colors"
                    />
                    <Button onClick={handleAddSport} disabled={!newSportName}>Aggiungi</Button>
                </div>
            </div>

            {/* Locations Management */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
                <h3 className="text-lg font-bold text-white mb-2">Sedi</h3>
                <p className="text-sm text-slate-400 mb-6">Dove si svolgono le lezioni e su quale calendario salvare.</p>
                 <div className="space-y-3 mb-6">
                    {config.locations.map(loc => (
                        <div key={loc.id} className="bg-slate-900/50 p-4 rounded-lg border border-slate-700 flex items-center justify-between gap-4">
                             {editingLocationId === loc.id ? (
                                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <input 
                                        className="p-2 bg-slate-800 border border-slate-600 rounded text-white text-sm"
                                        value={tempLocation.name || ''} 
                                        onChange={e => setTempLocation({...tempLocation, name: e.target.value})} 
                                    />
                                    <input 
                                        className="p-2 bg-slate-800 border border-slate-600 rounded text-white text-sm"
                                        value={tempLocation.address || ''} 
                                        onChange={e => setTempLocation({...tempLocation, address: e.target.value})} 
                                    />
                                    <input 
                                        className="p-2 bg-slate-800 border border-slate-600 rounded text-white text-sm md:col-span-2"
                                        value={tempLocation.googleCalendarId || ''} 
                                        onChange={e => setTempLocation({...tempLocation, googleCalendarId: e.target.value})} 
                                        placeholder="ID Google Calendar (opzionale)"
                                    />
                                    <div className="flex gap-2 md:col-span-2 justify-end">
                                        <Button size="sm" onClick={saveEditLocation} className="text-xs py-1 px-3">Salva</Button>
                                        <button onClick={() => setEditingLocationId(null)} className="text-slate-400 text-xs hover:text-white">Annulla</button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div>
                                        <div className="font-bold text-white flex items-center gap-2">
                                            {loc.name}
                                            <button onClick={() => startEditLocation(loc)} className="text-slate-500 hover:text-white transition-colors">
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                                            </button>
                                        </div>
                                        <div className="text-sm text-slate-400">{loc.address}</div>
                                        {loc.googleCalendarId && <div className="text-xs text-indigo-400 mt-1 font-mono bg-indigo-900/20 inline-block px-1 rounded">{loc.googleCalendarId}</div>}
                                        {!loc.googleCalendarId && <div className="text-xs text-slate-600 mt-1 font-mono bg-slate-800 inline-block px-1 rounded">Nessun Cal ID</div>}
                                    </div>
                                    <button onClick={() => removeLocation(loc.id)} className="p-2 hover:bg-red-900/20 rounded-lg text-slate-400 hover:text-red-400 transition-colors">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                    </button>
                                </>
                            )}
                        </div>
                    ))}
                 </div>
                 
                 <div className="p-4 bg-slate-900/30 rounded-lg border border-slate-700/50 space-y-3">
                    <input 
                        className="w-full bg-transparent border-b border-slate-700 focus:border-indigo-500 outline-none text-white py-2 transition-colors" 
                        value={newLocationName} 
                        onChange={e => setNewLocationName(e.target.value)} 
                        placeholder="Nome Sede (es. Club Centrale)" 
                    />
                    <div className="flex gap-3">
                        <input 
                            className="flex-1 bg-transparent border-b border-slate-700 focus:border-indigo-500 outline-none text-white py-2 transition-colors" 
                            value={newLocationAddr} 
                            onChange={e => setNewLocationAddr(e.target.value)} 
                            placeholder="Indirizzo" 
                        />
                        <Button onClick={handleAddLocation} disabled={!newLocationName}>Aggiungi</Button>
                    </div>
                 </div>
            </div>

             {/* Durations Management */}
             <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
                <h3 className="text-lg font-bold text-white mb-4">Durate Lezioni</h3>
                <div className="flex flex-wrap gap-3 mb-6">
                    {config.durations.map(d => (
                         <div key={d.minutes} className="bg-slate-900 px-4 py-2 rounded-lg border border-slate-700 flex items-center gap-3">
                             <span className="text-white font-bold">{d.minutes} min</span>
                             <button onClick={() => removeDuration(d.minutes)} className="text-slate-500 hover:text-red-400">×</button>
                         </div>
                    ))}
                </div>
                 <div className="flex gap-3 max-w-xs">
                    <input 
                        type="number" 
                        className="bg-slate-900 border border-slate-600 rounded-lg text-white px-3 w-24 text-center" 
                        value={newDuration} 
                        onChange={e => setNewDuration(e.target.value)} 
                        placeholder="Min" 
                    />
                    <Button onClick={handleAddDuration}>Aggiungi Durata</Button>
                 </div>
             </div>

             <div className="pt-10 border-t border-slate-800">
                 <Button variant="ghost" onClick={handleResetConfig} className="text-red-500 hover:bg-red-950 hover:text-red-400 w-full">
                     Ripristina Configurazione Iniziale
                 </Button>
             </div>
        </div>
      )}

       {/* TAB: HOME SETTINGS */}
       {activeTab === 'home' && (
           <div className="max-w-2xl mx-auto animate-in fade-in space-y-6">
                 <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
                    <h3 className="text-lg font-bold text-white mb-6">Testi Pagina Iniziale</h3>
                    <div className="space-y-6">
                        <div>
                            <label className="text-xs text-slate-400 uppercase font-bold mb-2 block">Titolo Principale</label>
                            <input 
                                className="w-full p-4 bg-slate-900 border border-slate-600 rounded-lg text-white text-xl font-bold" 
                                value={homeTitle} 
                                onChange={e => setHomeTitle(e.target.value)} 
                            />
                        </div>
                        <div>
                            <label className="text-xs text-slate-400 uppercase font-bold mb-2 block">Sottotitolo</label>
                            <textarea 
                                className="w-full p-4 bg-slate-900 border border-slate-600 rounded-lg text-white text-lg h-32 resize-none" 
                                value={homeSubtitle} 
                                onChange={e => setHomeSubtitle(e.target.value)} 
                            />
                        </div>
                        <Button onClick={handleUpdateHome} className="w-full">Salva Modifiche</Button>
                    </div>
                </div>
           </div>
       )}

    </div>
  );
};

export default AdminDashboard;
