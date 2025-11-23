
import React, { useState, useEffect, useCallback } from 'react';
import { TimeSlot, Booking, Sport, SportLocation, LessonType, LessonDuration } from '../types';
import { getAvailableSlots, saveBooking } from '../services/calendarService';
import { getAppConfig } from '../services/configService';
import { generateLessonPlan, suggestAvailabilitySummary } from '../services/geminiService';
import Button from './Button';

const BookingFlow: React.FC = () => {
  const config = getAppConfig(); 

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

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState<Booking | null>(null);
  const [generatedPlan, setGeneratedPlan] = useState<string>('');

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
  }, [selectedDate, selectedDuration, selectedLocation, selectedSport]);

  useEffect(() => {
    if (currentStep === 2) { // Slot selection step
        fetchSlots();
    }
  }, [currentStep, fetchSlots]);

  const handleDateChange = (offset: number) => {
      const newDate = new Date(selectedDate);
      newDate.setDate(newDate.getDate() + offset);
      if (newDate < new Date(new Date().setHours(0,0,0,0))) return;
      setSelectedDate(newDate);
  };

  const handleConfirm = async () => {
      if (!selectedSport || !selectedSlot || !selectedLocation || !selectedDuration) return;

      setIsSubmitting(true);

      const aiPlan = await generateLessonPlan({
          sport: selectedSport.name,
          skillLevel: formData.level,
          durationMinutes: selectedDuration,
          lessonType: selectedLessonType?.name
      });
      setGeneratedPlan(aiPlan);

      const newBooking: Booking = {
          id: Date.now().toString(),
          sportId: selectedSport.id,
          sportName: selectedSport.name,
          locationId: selectedLocation.id,
          locationName: selectedLocation.name,
          lessonTypeId: selectedLessonType?.id,
          lessonTypeName: selectedLessonType?.name,
          durationMinutes: selectedDuration,
          date: selectedDate.toISOString().split('T')[0],
          timeSlotId: selectedSlot.id,
          startTime: selectedSlot.startTime,
          customerName: formData.name,
          customerEmail: formData.email,
          customerPhone: formData.phone,
          skillLevel: formData.level,
          notes: formData.notes,
          aiLessonPlan: aiPlan
      };

      saveBooking(newBooking);
      setConfirmedBooking(newBooking);
      setIsSubmitting(false);
      setCurrentStep(4); // Success Step
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
                {config.sports.map(sport => (
                    <button 
                        key={sport.id}
                        onClick={() => { setSelectedSport(sport); setCurrentStep(1); }}
                        className="group p-6 rounded-2xl text-left transition-all duration-300 bg-slate-800/50 border border-slate-700 hover:bg-slate-800 hover:border-indigo-500 hover:shadow-lg hover:shadow-indigo-500/20"
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-4xl mb-2">{sport.emoji}</div>
                                <div className="font-bold text-xl text-white group-hover:text-indigo-400 transition-colors">{sport.name}</div>
                                <p className="text-sm text-slate-400 mt-1">{sport.description}</p>
                            </div>
                            <div className="w-8 h-8 rounded-full bg-slate-700 text-slate-400 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-all">→</div>
                        </div>
                    </button>
                ))}
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
                  <div className="text-4xl mb-2">{selectedSport.emoji}</div>
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
                            className={`py-3 px-2 rounded-xl text-sm font-medium transition-all ${selectedSlot?.id === slot.id ? 'bg-indigo-600 text-white shadow-lg ring-2 ring-indigo-400' : slot.isAvailable ? 'bg-slate-700/50 text-slate-200 hover:bg-slate-600' : 'bg-slate-900/50 text-slate-600 cursor-not-allowed'}`}
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
            <button onClick={() => setCurrentStep(2)} className="text-slate-400 hover:text-white text-sm flex items-center gap-1 mb-2">← Indietro</button>
            
            <div className="bg-slate-800/50 backdrop-blur rounded-2xl border border-slate-700 p-6 md:p-8 shadow-xl">
                <h2 className="text-2xl font-bold text-white mb-6">I tuoi Dati</h2>
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
                </div>
            </div>

             <div className="flex justify-center pt-4">
                <Button disabled={!formData.name || !formData.email || !formData.phone} onClick={handleConfirm} isLoading={isSubmitting} className="w-full md:w-auto md:min-w-[250px] py-4 text-lg">Conferma Prenotazione</Button>
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
                  <div className="font-bold text-white text-lg mb-4">{new Date(confirmedBooking.date).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long'})} alle {new Date(confirmedBooking.startTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                  <div className="text-slate-300 mb-6">
                      {confirmedBooking.sportName} - {confirmedBooking.locationName}<br/>
                      {confirmedBooking.lessonTypeName} ({confirmedBooking.durationMinutes} min)
                  </div>
                  <div className="prose prose-invert prose-sm max-w-none bg-slate-900/50 p-6 rounded-xl border border-slate-700/50">
                     {generatedPlan.split('\n').map((line, i) => <p key={i} className={line.startsWith('**') ? 'font-bold text-white mt-4' : 'text-slate-300'}>{line.replace(/\*\*/g, '')}</p>)}
                  </div>

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
