
import React, { useState, useEffect, useCallback } from 'react';
import { TimeSlot, Booking, Sport, SportLocation, LessonType, LessonDuration, AppConfig } from '../types';
import { getAvailableSlots, saveBooking } from '../services/calendarService';
import { getAppConfig, initConfigListener } from '../services/configService';
import { generateLessonPlan, suggestAvailabilitySummary } from '../services/geminiService';
import Button from './Button';

const OWNER_WHATSAPP_NUMBER = '393428009404';

const BookingFlow: React.FC = () => {
  // Use State for config to trigger re-renders when it updates
  const [config, setConfig] = useState<AppConfig>(getAppConfig()); 

  const [currentStep, setCurrentStep] = useState(0);
  
  // SELECTION STATE
  const [selectedSport, setSelectedSport] = useState<Sport | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<SportLocation | null>(null);
  const [selectedLessonType, setSelectedLessonType] = useState<LessonType | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  
  // DATA STATE
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [aiSummary, setAiSummary] = useState<string>('');
  
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    level: 'Beginner' as Booking['skillLevel'],
    notes: ''
  });
  const [athleticRequest, setAthleticRequest] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState<Booking | null>(null);
  const [generatedPlan, setGeneratedPlan] = useState<string>('');
  const isAthleticPreparationSport = selectedSport?.offerType === 'ATHLETIC_PREPARATION';

  // Listen for real-time config updates (e.g. Min Notice changes)
  useEffect(() => {
    const unsub = initConfigListener((newConfig) => {
        setConfig(newConfig);
    });
    return () => unsub();
  }, []);

  if (!config.sports || config.sports.length === 0) {
      return (
          <div className="text-center py-20 text-slate-400">
              <h3 className="text-xl font-bold text-white">Configurazione mancante</h3>
              <p>L'istruttore deve configurare gli sport nella dashboard.</p>
          </div>
      );
  }

  useEffect(() => {
      setSelectedSlot(null);
  }, [selectedDate, selectedDuration]);

  const fetchSlots = useCallback(async () => {
     if(!selectedDuration || !selectedLocation || !selectedSport) return;
     
     setIsLoadingSlots(true);
     await new Promise(r => setTimeout(r, 400)); // UX Delay
     
     const slots = getAvailableSlots(selectedDate, selectedDuration, selectedSport.id, selectedLocation.id);
     setAvailableSlots(slots);
     setIsLoadingSlots(false);

     const availableCount = slots.filter(s => s.isAvailable).length;
     suggestAvailabilitySummary(availableCount).then(setAiSummary);
  }, [selectedDate, selectedDuration, selectedLocation, selectedSport, config]); // config is now a dependency

  useEffect(() => {
    if (currentStep === 2) { // Slot selection step
        fetchSlots();
    }
  }, [currentStep, fetchSlots, config]); // config dependency triggers refetch

  const handleDateChange = (offset: number) => {
      const newDate = new Date(selectedDate);
      newDate.setDate(newDate.getDate() + offset);
      if (newDate < new Date(new Date().setHours(0,0,0,0))) return;
      setSelectedDate(newDate);
  };

  const handleConfirm = async () => {
      if (!selectedSport) return;
      if (!isAthleticPreparationSport && (!selectedSlot || !selectedLocation || !selectedDuration)) return;
      if (isAthleticPreparationSport && !athleticRequest.trim()) return;

      setIsSubmitting(true);

      const aiPlan = await generateLessonPlan({
          sport: selectedSport.name,
          skillLevel: formData.level,
          durationMinutes: selectedDuration || 60,
          lessonType: isAthleticPreparationSport ? 'Preparazione atletica' : selectedLessonType?.name,
          focusArea: isAthleticPreparationSport ? athleticRequest.trim() : undefined
      });
      setGeneratedPlan(aiPlan);

      const newBooking: Booking = {
          id: Date.now().toString(),
          sportId: selectedSport.id,
          sportName: selectedSport.name,
          locationId: isAthleticPreparationSport ? 'athletic_preparation' : selectedLocation!.id,
          locationName: isAthleticPreparationSport ? 'Preparazione atletica' : selectedLocation!.name,
          lessonTypeId: isAthleticPreparationSport ? 'athletic_preparation' : selectedLessonType?.id,
          lessonTypeName: isAthleticPreparationSport ? 'Richiesta programma' : selectedLessonType?.name,
          durationMinutes: isAthleticPreparationSport ? 60 : selectedDuration!,
          date: isAthleticPreparationSport ? new Date().toISOString().split('T')[0] : selectedDate.toISOString().split('T')[0],
          timeSlotId: isAthleticPreparationSport ? 'athletic_request' : selectedSlot!.id,
          startTime: isAthleticPreparationSport ? new Date().toISOString() : selectedSlot!.startTime,
          customerName: formData.name,
          customerEmail: formData.email,
          customerPhone: formData.phone,
          skillLevel: formData.level,
          notes: isAthleticPreparationSport ? undefined : formData.notes,
          athleticRequest: isAthleticPreparationSport ? athleticRequest.trim() : undefined,
          aiLessonPlan: aiPlan
      };

      saveBooking(newBooking);
      setConfirmedBooking(newBooking);
      setIsSubmitting(false);
      setCurrentStep(4); // Success Step
  };

  // --- CALENDAR EXPORT HELPERS ---
  const getCalendarDates = (booking: Booking) => {
      const start = new Date(booking.startTime);
      const end = new Date(start.getTime() + booking.durationMinutes * 60000);
      return {
          start: start.toISOString().replace(/-|:|\.\d\d\d/g, ""),
          end: end.toISOString().replace(/-|:|\.\d\d\d/g, "")
      };
  };

  const addToGoogleCalendar = () => {
      if (!confirmedBooking) return;
      const { start, end } = getCalendarDates(confirmedBooking);
      const url = new URL('https://calendar.google.com/calendar/render');
      url.searchParams.append('action', 'TEMPLATE');
      url.searchParams.append('text', `Lezione ${confirmedBooking.sportName}: ${confirmedBooking.lessonTypeName}`);
      url.searchParams.append('dates', `${start}/${end}`);
      url.searchParams.append('details', `Prenotazione confermata.\n\nNote: ${confirmedBooking.notes || 'Nessuna'}\n\nPiano Lezione:\n${generatedPlan}`);
      url.searchParams.append('location', confirmedBooking.locationName);
      window.open(url.toString(), '_blank');
  };

  const downloadIcsFile = () => {
      if (!confirmedBooking) return;
      const { start, end } = getCalendarDates(confirmedBooking);
      const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//GestionalePrenotazioni//IT
BEGIN:VEVENT
UID:${confirmedBooking.id}@gestionaleprenotazioni.app
DTSTAMP:${new Date().toISOString().replace(/-|:|\.\d\d\d/g, "")}
DTSTART:${start}
DTEND:${end}
SUMMARY:Lezione ${confirmedBooking.sportName} - ${confirmedBooking.lessonTypeName}
DESCRIPTION:Prenotazione confermata. Note: ${confirmedBooking.notes || 'Nessuna'}
LOCATION:${confirmedBooking.locationName}
END:VEVENT
END:VCALENDAR`;

      const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
      const link = document.createElement('a');
      link.href = window.URL.createObjectURL(blob);
      link.setAttribute('download', `prenotazione_${confirmedBooking.sportName}.ics`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  const getAthleticPreparationWhatsappUrl = (booking: Booking) => {
      const messageLines = [
          'Ciao, ti ho inviato una richiesta di preparazione atletica.',
          `Nome: ${booking.customerName}`,
          `Sport: ${booking.sportName}`,
          booking.athleticRequest ? `Richiesta: ${booking.athleticRequest}` : ''
      ].filter(Boolean);

      const url = new URL(`https://wa.me/${OWNER_WHATSAPP_NUMBER}`);
      url.searchParams.set('text', messageLines.join('\n'));
      return url.toString();
  };

  const levelLabels: Record<string, string> = {
      'Beginner': 'Principiante',
      'Intermediate': 'Intermedio',
      'Advanced': 'Avanzato'
  };

  // --- STEP 0: SPORT SELECTION ---
  if (currentStep === 0) {
      return (
        <div className="space-y-10 animate-in fade-in">
            <div className="text-center space-y-3">
                <h1 className="text-4xl font-extrabold text-white">{config.homeTitle}</h1>
                <p className="text-lg text-slate-400 max-w-xl mx-auto">{config.homeSubtitle}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl mx-auto">
                {config.sports.map(sport => {
                    // Logic to distinguish colors based on sport name
                    const isTennis = sport.name.toLowerCase().includes('tennis');
                    const isPadel = sport.name.toLowerCase().includes('padel');

                    // Default Style (Neutral)
                    let containerClass = "bg-slate-800/50 border-slate-700 hover:border-indigo-500 hover:shadow-indigo-500/20";
                    let titleClass = "group-hover:text-indigo-400";
                    let arrowClass = "group-hover:bg-indigo-600";
                    let decorClass = "bg-indigo-500";

                    // Tennis Style (Orange)
                    if (isTennis) {
                        containerClass = "bg-slate-800/50 border-slate-700 hover:border-orange-500 hover:shadow-orange-500/20 hover:bg-orange-500/5";
                        titleClass = "group-hover:text-orange-400";
                        arrowClass = "group-hover:bg-orange-500";
                        decorClass = "bg-orange-500";
                    } 
                    // Padel Style (Cyan/Blue)
                    else if (isPadel) {
                        containerClass = "bg-slate-800/50 border-slate-700 hover:border-cyan-500 hover:shadow-cyan-500/20 hover:bg-cyan-500/5";
                        titleClass = "group-hover:text-cyan-400";
                        arrowClass = "group-hover:bg-cyan-500";
                        decorClass = "bg-cyan-500";
                    }

                    return (
                        <button 
                            key={sport.id}
                            onClick={() => {
                                setSelectedSport(sport);
                                setSelectedLocation(null);
                                setSelectedLessonType(null);
                                setSelectedDuration(null);
                                setSelectedSlot(null);
                                setAthleticRequest('');
                                setCurrentStep(sport.offerType === 'ATHLETIC_PREPARATION' ? 3 : 1);
                            }}
                            className={`group p-8 rounded-2xl text-left transition-all duration-300 border hover:shadow-xl ${containerClass}`}
                        >
                            <div className="flex items-center justify-between h-full">
                                <div className="flex flex-col h-full justify-between">
                                    <div>
                                        {/* Colored Decorative Bar instead of Emoji */}
                                        <div className={`w-10 h-1.5 rounded-full mb-6 ${decorClass} opacity-90 shadow-sm`}></div>
                                        <div className={`font-bold text-3xl text-white transition-colors mb-2 ${titleClass}`}>{sport.name}</div>
                                        <p className="text-sm text-slate-400 leading-relaxed">{sport.description}</p>
                                    </div>
                                </div>
                                <div className={`w-12 h-12 rounded-full bg-slate-700 text-slate-400 flex items-center justify-center transition-all ${arrowClass} group-hover:text-white ml-4 flex-shrink-0`}>
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
      );
  }

  // --- STEP 1: DETAILS (Location, Type, Duration) ---
  if (currentStep === 1 && selectedSport) {
      return (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
              <button onClick={() => setCurrentStep(0)} className="text-slate-400 hover:text-white text-sm flex items-center gap-1">← Cambia Sport</button>
              
              <div className="text-center mb-8">
                  {/* Title without Emoji */}
                  <h2 className="text-3xl font-bold text-white">{selectedSport.name}</h2>
                  <p className="text-slate-400">Configura la tua lezione</p>
              </div>

              <div className="bg-slate-800/40 backdrop-blur border border-slate-700 rounded-2xl p-6 max-w-2xl mx-auto space-y-6">
                  
                  {/* Location Selection */}
                  <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Dove vuoi giocare?</label>
                      {selectedSport.locations.length > 0 ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {selectedSport.locations.map(loc => (
                                  <button
                                      key={loc.id}
                                      onClick={() => setSelectedLocation(loc)}
                                      className={`p-4 rounded-xl border text-left transition-all ${selectedLocation?.id === loc.id ? 'bg-indigo-600/20 border-indigo-500 text-white' : 'bg-slate-900/50 border-slate-700 text-slate-300 hover:border-slate-500'}`}
                                  >
                                      <div className="font-bold">{loc.name}</div>
                                      <div className="text-xs opacity-70">{loc.address}</div>
                                  </button>
                              ))}
                          </div>
                      ) : <div className="text-red-400 text-sm">Nessuna sede disponibile per questo sport.</div>}
                  </div>

                  {/* Lesson Type Selection */}
                  {selectedLocation && (
                    <div className="animate-in fade-in">
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Tipo di Lezione</label>
                        <div className="flex flex-wrap gap-3">
                            {selectedSport.lessonTypes.map(type => (
                                <button
                                    key={type.id}
                                    onClick={() => setSelectedLessonType(type)}
                                    className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${selectedLessonType?.id === type.id ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-900/50 text-slate-300 border-slate-700 hover:border-slate-500'}`}
                                >
                                    {type.name}
                                </button>
                            ))}
                        </div>
                    </div>
                  )}

                  {/* Duration Selection */}
                  {selectedLocation && selectedLessonType && (
                      <div className="animate-in fade-in">
                          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Durata</label>
                          <div className="flex flex-wrap gap-3">
                              {selectedSport.durations.map(d => (
                                  <button
                                      key={d}
                                      onClick={() => setSelectedDuration(d)}
                                      className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${selectedDuration === d ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-900/50 text-slate-300 border-slate-700 hover:border-slate-500'}`}
                                  >
                                      {d} Minuti
                                  </button>
                              ))}
                          </div>
                      </div>
                  )}
              </div>

              <div className="flex justify-center pt-4">
                <Button 
                    disabled={!selectedLocation || !selectedLessonType || !selectedDuration} 
                    onClick={() => setCurrentStep(2)}
                    className="w-full md:w-auto md:min-w-[200px] text-lg"
                >
                    Vedi Orari Disponibili
                </Button>
            </div>
          </div>
      );
  }

  // --- STEP 2: DATE & TIME ---
  if (currentStep === 2 && selectedSport) {
      return (
        <div className="space-y-6 animate-in fade-in">
            <div className="flex items-center justify-between mb-2">
                <button onClick={() => setCurrentStep(1)} className="text-slate-400 hover:text-white text-sm flex items-center gap-1">← Indietro</button>
                <div className="text-right hidden sm:block text-xs text-slate-500">
                    {selectedSport.name} • {selectedLocation?.name} • {selectedDuration} min
                </div>
            </div>

            <div className="bg-slate-800/50 backdrop-blur rounded-2xl border border-slate-700 p-6 md:p-8 shadow-xl">
                <div className="flex items-center justify-between mb-8 bg-slate-900/50 p-4 rounded-xl border border-slate-700/50">
                    <button onClick={() => handleDateChange(-1)} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg></button>
                    <div className="text-center">
                        <div className="text-xl font-bold text-white capitalize">
                            {selectedDate.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}
                        </div>
                        <div className="text-sm text-indigo-400 font-medium mt-1 h-5 animate-pulse">{isLoadingSlots ? '...' : aiSummary}</div>
                    </div>
                    <button onClick={() => handleDateChange(1)} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg></button>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                    {isLoadingSlots ? Array.from({length: 10}).map((_, i) => (
                        <div key={i} className="h-12 bg-slate-700/50 rounded-lg animate-pulse"></div>
                    )) : availableSlots.length > 0 ? availableSlots.map(slot => (
                        <button
                            key={slot.id}
                            disabled={!slot.isAvailable}
                            onClick={() => setSelectedSlot(slot)}
                            className={`py-3 px-2 rounded-xl text-sm font-medium transition-all ${selectedSlot?.id === slot.id ? 'bg-indigo-600 text-white shadow-lg ring-2 ring-indigo-400' : slot.isAvailable ? 'bg-slate-700/50 text-slate-200 hover:bg-slate-600' : 'bg-slate-900/50 text-slate-600 cursor-not-allowed opacity-50'}`}
                        >
                            {new Date(slot.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </button>
                    )) : (
                        <div className="col-span-full text-center py-10 text-slate-500">Nessuno slot disponibile.</div>
                    )}
                </div>
            </div>

            <div className="flex justify-center pt-4">
                <Button disabled={!selectedSlot} onClick={() => setCurrentStep(3)} className="w-full md:w-auto md:min-w-[200px]">Continua</Button>
            </div>
        </div>
      );
  }

  // --- STEP 3: USER DATA ---
  if (currentStep === 3) {
      return (
          <div className="space-y-6 animate-in fade-in">
            <button onClick={() => setCurrentStep(isAthleticPreparationSport ? 0 : 2)} className="text-slate-400 hover:text-white text-sm flex items-center gap-1 mb-2">
              ← {isAthleticPreparationSport ? 'Cambia Sport' : 'Indietro'}
            </button>
            
            <div className="bg-slate-800/50 backdrop-blur rounded-2xl border border-slate-700 p-6 md:p-8 shadow-xl">
                <h2 className="text-2xl font-bold text-white mb-6">
                  {isAthleticPreparationSport ? 'Richiesta Preparazione Atletica' : 'I tuoi Dati'}
                </h2>
                <div className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <input 
                            type="text" 
                            className="w-full p-4 bg-slate-900 border border-slate-600 rounded-xl text-white focus:border-indigo-500 outline-none" 
                            value={formData.name} 
                            onChange={e => setFormData({...formData, name: e.target.value})} 
                            placeholder="Nome Completo" 
                        />
                        <input 
                            type="tel" 
                            className="w-full p-4 bg-slate-900 border border-slate-600 rounded-xl text-white focus:border-indigo-500 outline-none" 
                            value={formData.phone} 
                            onChange={e => setFormData({...formData, phone: e.target.value})} 
                            placeholder="Numero di Telefono" 
                        />
                         <input 
                            type="email" 
                            className="w-full p-4 bg-slate-900 border border-slate-600 rounded-xl text-white focus:border-indigo-500 outline-none md:col-span-2" 
                            value={formData.email} 
                            onChange={e => setFormData({...formData, email: e.target.value})} 
                            placeholder="Email" 
                        />
                    </div>
                    <div>
                         <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Livello di Gioco</label>
                         <div className="grid grid-cols-3 gap-3">
                             {['Beginner', 'Intermediate', 'Advanced'].map(level => (
                                 <button key={level} onClick={() => setFormData({...formData, level: level as any})} className={`py-3 rounded-xl text-sm font-medium border ${formData.level === level ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-900 text-slate-400 border-slate-700'}`}>
                                     {levelLabels[level]}
                                 </button>
                             ))}
                         </div>
                    </div>
                   {isAthleticPreparationSport ? (
                     <div>
                       <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                         Richiesta programma di allenamento
                       </label>
                       <textarea
                         className="w-full p-4 bg-slate-900 border border-slate-600 rounded-xl text-white min-h-[140px] focus:border-indigo-500 outline-none"
                         value={athleticRequest}
                         onChange={e => setAthleticRequest(e.target.value)}
                         placeholder="Descrivi obiettivi, disponibilità, eventuali infortuni, priorità o focus del programma..."
                       />
                     </div>
                   ) : (
                     <div>
                         <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Note Aggiuntive</label>
                         <textarea className="w-full p-4 bg-slate-900 border border-slate-600 rounded-xl text-white min-h-[100px] focus:border-indigo-500 outline-none mb-2" value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} placeholder="Es. Ho bisogno di racchette..." />
                          
                         {/* IMPORTANT WARNING MESSAGE */}
                         <div className="p-4 mt-2 border-2 border-amber-400/30 bg-amber-500/10 rounded-xl text-center">
                             <p className="font-extrabold text-amber-400 text-sm md:text-base uppercase tracking-wide leading-relaxed">
                                 COMUNICA SU WHATSAPP LA PRENOTAZIONE DELLA LEZIONE, LA LEZIONE VERRA' CONFERMATA DOPO LA VERIFICA DELLA DISPONIBILITA' DEL CAMPO
                             </p>
                         </div>
                     </div>
                   )}
               </div>
            </div>

            <div className="flex justify-center pt-4">
               <Button
                 disabled={!formData.name || !formData.email || !formData.phone || (isAthleticPreparationSport && !athleticRequest.trim())}
                 onClick={handleConfirm}
                 isLoading={isSubmitting}
                 className="w-full md:w-auto md:min-w-[250px] py-4 text-lg"
               >
                 {isAthleticPreparationSport ? 'Invia Richiesta Programma' : 'Conferma Prenotazione'}
               </Button>
            </div>
          </div>
      );
  }

  // --- STEP 4: SUCCESS ---
  if (currentStep === 4 && confirmedBooking) {
      return (
          <div className="text-center py-10 animate-in zoom-in duration-500">
              <div className="w-24 h-24 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-emerald-500/30">✓</div>
              <h2 className="text-4xl font-bold text-white mb-2">Richiesta Inviata!</h2>
              <div className="bg-slate-800/80 backdrop-blur rounded-2xl border border-slate-700 p-8 max-w-2xl mx-auto text-left shadow-2xl mt-8 relative overflow-hidden">
                  <div className="font-bold text-white text-lg mb-4">
                    {confirmedBooking.athleticRequest
                      ? 'La tua richiesta di preparazione atletica è stata registrata.'
                      : `${new Date(confirmedBooking.date).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long'})} alle ${new Date(confirmedBooking.startTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`}
                  </div>
                  <div className="text-slate-300 mb-6">
                      {confirmedBooking.sportName} - {confirmedBooking.locationName}<br/>
                      {confirmedBooking.athleticRequest
                        ? confirmedBooking.lessonTypeName
                        : `${confirmedBooking.lessonTypeName} (${confirmedBooking.durationMinutes} min)`}
                  </div>
                  {confirmedBooking.athleticRequest && (
                    <div className="mb-6 p-4 rounded-xl border border-slate-700 bg-slate-900/60 text-sm text-slate-300">
                      <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Richiesta inviata</div>
                      {confirmedBooking.athleticRequest}
                    </div>
                  )}
                  {confirmedBooking.athleticRequest && (
                    <a
                      href={getAthleticPreparationWhatsappUrl(confirmedBooking)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mb-6 w-full py-3 px-4 rounded-xl border border-emerald-400/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200 hover:text-emerald-100 font-semibold flex items-center justify-center gap-2 transition-colors"
                    >
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M20.52 3.48A11.82 11.82 0 0012.1.02C5.58.02.3 5.3.3 11.82c0 2.08.54 4.11 1.57 5.9L.02 24l6.47-1.7a11.77 11.77 0 005.61 1.43h.01c6.52 0 11.8-5.28 11.8-11.8 0-3.15-1.23-6.1-3.39-8.45ZM12.11 21.7h-.01a9.8 9.8 0 01-4.99-1.37l-.36-.21-3.84 1.01 1.03-3.74-.24-.38a9.78 9.78 0 01-1.5-5.19c0-5.4 4.4-9.8 9.81-9.8 2.61 0 5.06 1.02 6.91 2.87a9.7 9.7 0 012.87 6.9c0 5.41-4.4 9.81-9.8 9.81Zm5.37-7.35c-.29-.15-1.73-.85-2-0.95-.27-.1-.47-.15-.66.15-.2.29-.76.95-.93 1.14-.17.2-.34.22-.63.08-.29-.14-1.24-.46-2.35-1.46a8.86 8.86 0 01-1.63-2.03c-.17-.29-.02-.45.13-.6.13-.13.29-.34.44-.51.15-.17.2-.29.29-.49.1-.19.05-.36-.02-.51-.07-.14-.66-1.6-.9-2.2-.24-.58-.49-.5-.66-.5h-.56c-.2 0-.51.08-.78.36-.27.29-1.03 1-1.03 2.44 0 1.43 1.06 2.82 1.2 3.02.15.2 2.07 3.15 5.02 4.41.7.3 1.25.48 1.68.61.7.22 1.34.19 1.84.12.56-.08 1.73-.71 1.97-1.4.24-.68.24-1.26.17-1.39-.07-.12-.27-.2-.56-.34Z" />
                      </svg>
                      Apri WhatsApp
                    </a>
                  )}
                   
                  {/* Calendar Buttons */}
                  {!confirmedBooking.athleticRequest && (
                    <div className="flex flex-col sm:flex-row gap-3 mb-6">
                        <button 
                          onClick={addToGoogleCalendar}
                          className="flex-1 py-2 px-4 rounded-xl border border-slate-600 bg-slate-700 hover:bg-slate-600 text-white font-medium flex items-center justify-center gap-2 transition-colors"
                        >
                           <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 2C16.92 2 20.5 5.58 20.5 10C20.5 14.42 16.92 18 12.5 18C8.08 18 4.5 14.42 4.5 10C4.5 5.58 8.08 2 12.5 2M12.5 20C16.64 20 20 23.36 20 27.5C20 31.64 16.64 35 12.5 35C8.36 35 5 31.64 5 27.5C5 23.36 8.36 20 12.5 20M12.5 22C9.46 22 7 24.46 7 27.5C7 30.54 9.46 33 12.5 33C15.54 33 18 30.54 18 27.5C18 24.46 15.54 22 12.5 22Z" transform="scale(0.5)"/><path d="M19 4H18V2H16V4H8V2H6V4H5C3.89 4 3 4.9 3 6V20C3 21.1 3.89 22 5 22H19C20.1 22 21 21.1 21 20V6C21 4.9 20.1 4 19 4ZM19 20H5V10H19V20ZM19 8H5V6H19V8Z"/></svg>
                           Aggiungi a Google Calendar
                        </button>
                        <button 
                          onClick={downloadIcsFile}
                          className="flex-1 py-2 px-4 rounded-xl border border-slate-600 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-medium flex items-center justify-center gap-2 transition-colors"
                        >
                           <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                           Scarica iCal / Outlook
                        </button>
                    </div>
                  )}

                  {generatedPlan && (
                    <div className="prose prose-invert prose-sm max-w-none bg-slate-900/50 p-6 rounded-xl border border-slate-700/50">
                        {generatedPlan.split('\n').map((line, i) => <p key={i} className={line.startsWith('**') ? 'font-bold text-white mt-4' : 'text-slate-300'}>{line.replace(/\*\*/g, '')}</p>)}
                    </div>
                  )}

                  <div className="mt-8 pt-6 border-t border-slate-700 text-center">
                       <p className="font-bold text-amber-400 uppercase text-sm tracking-wide leading-relaxed">
                            COMUNICA SU WHATSAPP LA PRENOTAZIONE DELLA LEZIONE, LA LEZIONE VERRA' CONFERMATA DOPO LA VERIFICA DELLA DISPONIBILITA' DEL CAMPO
                       </p>
                  </div>
              </div>
              <Button variant="outline" onClick={() => window.location.reload()} className="mt-10">Torna alla Home</Button>
          </div>
      );
  }

  return null;
};

export default BookingFlow;
