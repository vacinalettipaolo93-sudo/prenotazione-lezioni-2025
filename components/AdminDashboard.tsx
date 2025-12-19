
import React, { useState, useEffect, useRef } from 'react';
import { CalendarEvent, AppConfig, WeeklySchedule, SportLocation, Sport, LessonType, DailySchedule, Booking } from '../types';
import { getAllCalendarEvents, connectGoogleCalendar, disconnectGoogleCalendar, isCalendarConnected, initGoogleClient, syncGoogleEventsToFirebase, exportBookingsToGoogle, getBookings, listGoogleCalendars, deleteBooking, updateBooking, initBookingListener, importPlaytomicCsv } from '../services/calendarService';
import { getAppConfig, addSport, updateSport, removeSport, addSportLocation, updateSportLocation, removeSportLocation, addSportLessonType, removeSportLessonType, addSportDuration, removeSportDuration, updateHomeConfig, updateMinBookingNotice, initConfigListener, updateImportBusyCalendars, updateLocationException } from '../services/configService';
import { logout } from '../services/authService';
import Button from './Button';

interface AdminDashboardProps {
    onLogout: () => void;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onLogout }) => {
  const [activeTab, setActiveTab] = useState<'calendar' | 'config' | 'schedule' | 'home' | 'bookings'>('calendar');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [rawBookings, setRawBookings] = useState<Booking[]>([]);
  const [isConnected, setIsConnected] = useState(isCalendarConnected());
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isImportingCsv, setIsImportingCsv] = useState(false);
  const [config, setConfig] = useState<AppConfig>(getAppConfig());
  const [userCalendars, setUserCalendars] = useState<{id: string, summary: string, primary?: boolean}[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);
  
  const [newSportName, setNewSportName] = useState('');
  const [newLocName, setNewLocName] = useState('');
  const [newLocAddr, setNewLocAddr] = useState('');
  const [newLessonType, setNewLessonType] = useState('');
  const [newDuration, setNewDuration] = useState('60');
  const [expandedSportId, setExpandedSportId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedLocationForCsv, setSelectedLocationForCsv] = useState<string>('');

  // States per tab Orari (Eccezioni)
  const [schedSportId, setSchedSportId] = useState<string>('');
  const [schedLocId, setSchedLocId] = useState<string>('');
  const [excDate, setExcDate] = useState<string>('');
  const [excStart, setExcStart] = useState<string>('09:00');
  const [excEnd, setExcEnd] = useState<string>('22:00');
  const [excIsOpen, setExcIsOpen] = useState<boolean>(true);

  useEffect(() => {
    initGoogleClient().then(() => {
        setIsConnected(isCalendarConnected());
        if (isCalendarConnected()) fetchUserCalendars();
    });
    const unsubConfig = initConfigListener((newConfig) => {
        setConfig(newConfig);
        if (newConfig.importBusyCalendars) setSelectedCalendarIds(newConfig.importBusyCalendars);
    });
    const unsubBookings = initBookingListener((newBookings) => {
        setEvents(getAllCalendarEvents());
        setRawBookings(newBookings.filter(b => !['EXTERNAL_BUSY', 'PLAYTOMIC_BUSY'].includes(b.sportName)).sort((a,b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()));
    });
    return () => { unsubConfig(); unsubBookings(); };
  }, []);

  const fetchUserCalendars = async () => {
      try {
          const cals = await listGoogleCalendars();
          setUserCalendars(cals);
      } catch (e) { setIsConnected(false); }
  }

  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !selectedLocationForCsv) return;
      setIsImportingCsv(true);
      const reader = new FileReader();
      reader.onload = async (event) => {
          const content = event.target?.result as string;
          try {
              const count = await importPlaytomicCsv(content, selectedLocationForCsv);
              alert(`Importazione completata: ${count} slot Playtomic bloccati.`);
          } catch (err) { alert("Errore CSV."); }
          finally { 
              setIsImportingCsv(false);
              if (fileInputRef.current) fileInputRef.current.value = '';
          }
      };
      reader.readAsText(file);
  }

  const handleAddException = () => {
      if (!schedSportId || !schedLocId || !excDate) return;
      const daily: DailySchedule = {
          isOpen: excIsOpen,
          start: excStart,
          end: excEnd
      };
      updateLocationException(schedSportId, schedLocId, excDate, daily);
      setExcDate('');
  };

  const handleRemoveException = (date: string) => {
      if (!schedSportId || !schedLocId) return;
      updateLocationException(schedSportId, schedLocId, date, null);
  };

  const handleSyncNow = async () => {
      setIsSyncing(true);
      try {
          await syncGoogleEventsToFirebase(selectedCalendarIds);
          alert(`Sincronizzazione completata.`);
      } catch (e) { alert("Errore sync."); }
      finally { setIsSyncing(false); }
  }

  const allLocations: {id: string, name: string, sportName: string, sportId: string}[] = [];
  config.sports.forEach(s => s.locations.forEach(l => allLocations.push({id: l.id, name: l.name, sportName: s.name, sportId: s.id})));

  const currentSelectedLoc = config.sports.find(s => s.id === schedSportId)?.locations.find(l => l.id === schedLocId);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 relative">
      <div className="flex flex-col md:flex-row justify-between items-end mb-10 border-b border-slate-800 pb-6 gap-4">
        <div>
            <h1 className="text-3xl font-bold text-white">Dashboard Gestione</h1>
            <p className="text-slate-400 mt-1">Pannello di controllo istruttore</p>
        </div>
        <div className="flex bg-slate-800 p-1 rounded-xl border border-slate-700 overflow-x-auto">
            <button onClick={() => setActiveTab('calendar')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'calendar' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}>Calendario</button>
            <button onClick={() => setActiveTab('bookings')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'bookings' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}>Prenotazioni</button>
            <button onClick={() => setActiveTab('config')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'config' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}>Offerta</button>
            <button onClick={() => setActiveTab('schedule')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'schedule' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}>Orari</button>
        </div>
        <Button variant="outline" onClick={onLogout} className="text-red-400 border-red-900/50">Esci</Button>
      </div>

      {activeTab === 'calendar' && (
          <div className="space-y-8 animate-in fade-in">
             <div className="p-6 rounded-xl border bg-slate-800 border-slate-700">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-slate-700 text-slate-500 flex items-center justify-center text-xl">📅</div>
                        <div>
                            <h3 className="font-bold text-lg text-white">Google Calendar</h3>
                            <p className="text-sm text-slate-400">{isConnected ? "Sincronizzato (Filtro Anti-Doppioni Attivo)" : "Non collegato"}</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                         <Button onClick={handleSyncNow} isLoading={isSyncing} variant="secondary">Sync Ora</Button>
                         {!isConnected && <Button onClick={() => connectGoogleCalendar().then(() => setIsConnected(true))}>Connetti</Button>}
                    </div>
                </div>
             </div>
             <div className="p-6 rounded-xl border border-dashed border-cyan-500/30 bg-cyan-950/10">
                 <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-cyan-600/20 text-cyan-400 flex items-center justify-center font-bold">CSV</div>
                        <div>
                            <h3 className="font-bold text-lg text-white">Importa da Playtomic</h3>
                            <p className="text-sm text-slate-400">Carica il CSV scaricato da Playtomic per bloccare gli slot.</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <select className="bg-slate-900 border border-slate-600 rounded-lg p-2 text-sm text-white focus:border-cyan-500 outline-none w-48" value={selectedLocationForCsv} onChange={(e) => setSelectedLocationForCsv(e.target.value)}>
                            <option value="">-- Scegli Sede --</option>
                            {allLocations.map(loc => <option key={loc.id} value={loc.id}>{loc.sportName}: {loc.name}</option>)}
                        </select>
                        <input type="file" accept=".csv" hidden ref={fileInputRef} onChange={handleCsvImport} />
                        <Button variant="outline" disabled={!selectedLocationForCsv || isImportingCsv} onClick={() => fileInputRef.current?.click()} isLoading={isImportingCsv} className="border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10">Carica CSV</Button>
                    </div>
                 </div>
             </div>
          </div>
      )}

      {activeTab === 'schedule' && (
          <div className="space-y-8 animate-in fade-in">
              <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6">
                  <h2 className="text-xl font-bold text-white mb-6">Eccezioni Orari per Sede</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-2 tracking-wider">1. Seleziona Sport</label>
                          <select className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-indigo-500" value={schedSportId} onChange={e => {setSchedSportId(e.target.value); setSchedLocId('');}}>
                              <option value="">-- Seleziona --</option>
                              {config.sports.map(s => <option key={s.id} value={s.id}>{s.emoji} {s.name}</option>)}
                          </select>
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-2 tracking-wider">2. Seleziona Sede</label>
                          <select className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-indigo-500" value={schedLocId} onChange={e => setSchedLocId(e.target.value)} disabled={!schedSportId}>
                              <option value="">-- Seleziona --</option>
                              {config.sports.find(s => s.id === schedSportId)?.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                          </select>
                      </div>
                  </div>

                  {schedLocId && (
                      <div className="space-y-8 animate-in slide-in-from-top-2">
                          {/* Add Exception Form */}
                          <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-700">
                              <h3 className="text-sm font-bold text-indigo-400 uppercase mb-4">Aggiungi Eccezione (Chiusura o Orario Speciale)</h3>
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
                                  <div>
                                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Data</label>
                                      <input type="date" className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white text-sm outline-none" value={excDate} onChange={e => setExcDate(e.target.value)} />
                                  </div>
                                  <div>
                                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Stato</label>
                                      <select className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white text-sm outline-none" value={excIsOpen ? 'open' : 'closed'} onChange={e => setExcIsOpen(e.target.value === 'open')}>
                                          <option value="open">Aperto (Orario Speciale)</option>
                                          <option value="closed">Chiuso Tutto il Giorno</option>
                                      </select>
                                  </div>
                                  {excIsOpen && (
                                      <>
                                          <div>
                                              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Inizio</label>
                                              <input type="time" className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white text-sm outline-none" value={excStart} onChange={e => setExcStart(e.target.value)} />
                                          </div>
                                          <div>
                                              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Fine</label>
                                              <input type="time" className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white text-sm outline-none" value={excEnd} onChange={e => setExcEnd(e.target.value)} />
                                          </div>
                                      </>
                                  )}
                                  <Button onClick={handleAddException} className="lg:col-span-1" disabled={!excDate}>Aggiungi</Button>
                              </div>
                          </div>

                          {/* Exceptions List */}
                          <div>
                              <h3 className="text-sm font-bold text-slate-400 uppercase mb-4">Eccezioni Attive per questa Sede</h3>
                              <div className="space-y-2">
                                  {currentSelectedLoc?.scheduleExceptions && Object.entries(currentSelectedLoc.scheduleExceptions).length > 0 ? (
                                      Object.entries(currentSelectedLoc.scheduleExceptions).sort().map(([date, sched]) => (
                                          <div key={date} className="flex items-center justify-between p-4 bg-slate-800 border border-slate-700 rounded-xl">
                                              <div className="flex items-center gap-4">
                                                  <div className="font-bold text-white">{new Date(date).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
                                                  <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${sched.isOpen ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                                                      {sched.isOpen ? `${sched.start} - ${sched.end}` : 'Chiuso'}
                                                  </div>
                                              </div>
                                              <button onClick={() => handleRemoveException(date)} className="text-slate-500 hover:text-red-400 p-2 transition-colors">
                                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                              </button>
                                          </div>
                                      ))
                                  ) : (
                                      <p className="text-center py-8 text-slate-600 bg-slate-900/30 rounded-xl border border-dashed border-slate-800">Nessuna eccezione impostata per questa sede.</p>
                                  )}
                              </div>
                          </div>
                      </div>
                  )}
              </div>
          </div>
      )}

      {activeTab === 'bookings' && (
          <div className="animate-in fade-in space-y-4">
              <h2 className="text-xl font-bold text-white mb-6">Prenotazioni Attive</h2>
              <div className="grid grid-cols-1 gap-4">
                {rawBookings.map(b => (
                    <div key={b.id} className="p-4 rounded-xl border bg-slate-800 border-slate-700 flex justify-between items-center group hover:border-indigo-500/50 transition-all">
                        <div>
                            <div className="font-bold text-white">{new Date(b.startTime).toLocaleDateString('it-IT')} - {new Date(b.startTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                            <div className="text-sm text-slate-400">{b.customerName} - {b.sportName} <span className="text-indigo-400 opacity-60">({b.locationName})</span></div>
                        </div>
                        <div className="flex items-center gap-2">
                            {b.customerPhone && (
                                <a href={`https://wa.me/${b.customerPhone.replace(/\s+/g, '')}`} target="_blank" className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg border border-emerald-500/20 hover:bg-emerald-500/20">
                                     <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.438 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884 0 2.225.569 3.945 1.694 5.892l-.999 3.648 3.794-.991z"/></svg>
                                </a>
                            )}
                            <button onClick={() => deleteBooking(b.id)} className="text-red-400 text-xs border border-red-900/50 p-2 rounded hover:bg-red-900/10">Elimina</button>
                        </div>
                    </div>
                ))}
              </div>
          </div>
      )}

      {activeTab === 'config' && (
          <div className="animate-in fade-in space-y-6">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-white">Configurazione Sport</h2>
                <div className="flex gap-2">
                    <input className="bg-slate-900 border border-slate-700 rounded px-2 text-sm text-white outline-none" placeholder="Nuovo sport" value={newSportName} onChange={e => setNewSportName(e.target.value)} />
                    <Button onClick={() => { if(newSportName) { addSport(newSportName); setNewSportName(''); } }}>Aggiungi</Button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4">
                {config.sports.map(sport => (
                    <div key={sport.id} className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                        <div className="p-4 flex justify-between items-center cursor-pointer hover:bg-slate-700/30 transition-colors" onClick={() => setExpandedSportId(expandedSportId === sport.id ? null : sport.id)}>
                            <div className="flex items-center gap-3">
                                <span className="text-2xl">{sport.emoji}</span>
                                <span className="font-bold text-white text-lg">{sport.name}</span>
                            </div>
                            <span className={`transform transition-transform ${expandedSportId === sport.id ? 'rotate-180' : ''}`}>▼</span>
                        </div>
                        {expandedSportId === sport.id && (
                            <div className="p-6 bg-slate-900/50 border-t border-slate-700 space-y-6">
                                <div>
                                    <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Sedi Disponibili</h4>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {sport.locations.map(loc => (
                                            <div key={loc.id} className="flex justify-between items-center text-sm text-slate-300 bg-slate-800 p-3 rounded-xl border border-slate-700 group">
                                                <span>{loc.name}</span>
                                                <button onClick={() => removeSportLocation(sport.id, loc.id)} className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">×</button>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="flex gap-2 mt-4">
                                        <input className="flex-1 bg-slate-900 border border-slate-700 rounded-xl p-2 text-xs text-white outline-none focus:border-indigo-500" placeholder="Aggiungi nome sede" value={newLocName} onChange={e => setNewLocName(e.target.value)} />
                                        <button onClick={() => { if(newLocName) { addSportLocation(sport.id, newLocName, ""); setNewLocName(''); } }} className="bg-indigo-600 px-4 text-white rounded-xl text-xs font-bold hover:bg-indigo-500 transition-colors">AGGIUNGI</button>
                                    </div>
                                </div>
                                <div className="pt-4 border-t border-slate-800 flex justify-end">
                                    <button onClick={() => removeSport(sport.id)} className="text-red-900 hover:text-red-500 text-xs font-bold uppercase tracking-tighter">Elimina Intero Sport</button>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
              </div>
          </div>
      )}
    </div>
  );
};

export default AdminDashboard;
