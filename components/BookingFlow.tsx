
import React, { useState, useEffect, useCallback } from 'react';
import { TimeSlot, Booking, Sport, Location, LessonDuration } from '../types';
import { getAvailableSlots, saveBooking } from '../services/calendarService';
import { getAppConfig } from '../services/configService';
import { generateLessonPlan, suggestAvailabilitySummary } from '../services/geminiService';
import Button from './Button';

const BookingFlow: React.FC = () => {
  // Carica la configurazione ogni volta che il componente viene montato
  const config = getAppConfig(); 

  const [currentStep, setCurrentStep] = useState(0);
  
  // Selection State
  const [selectedSport, setSelectedSport] = useState<Sport | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(config.locations[0] || null);
  const [selectedDuration, setSelectedDuration] = useState<LessonDuration | null>(config.durations[0] || null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  
  // Data State
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [aiSummary, setAiSummary] = useState<string>('');
  
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    level: 'Beginner' as Booking['skillLevel'],
    notes: ''
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState<Booking | null>(null);
  const [generatedPlan, setGeneratedPlan] = useState<string>('');

  // Gestione caso nessuna configurazione
  if (config.sports.length === 0) {
      return (
          <div className="text-center py-20 bg-slate-800/50 backdrop-blur rounded-xl border border-dashed border-slate-700 text-slate-300">
              <div className="text-5xl mb-4 opacity-50">⚙️</div>
              <h3 className="text-xl font-bold text-white">Nessuna attività configurata</h3>
              <p className="text-slate-400 mt-2 mb-6">Accedi alla Dashboard Istruttore per configurare Sport, Sedi e Durate.</p>
          </div>
      );
  }

  // Reset slot if params change
  useEffect(() => {
      setSelectedSlot(null);
  }, [selectedDate, selectedDuration]);

  const fetchSlots = useCallback(async () => {
     if(!selectedDuration || !selectedLocation) return;
     
     setIsLoadingSlots(true);
     // Simulate network delay for realism
     await new Promise(r => setTimeout(r, 400));
     
     const slots = getAvailableSlots(selectedDate, selectedDuration.minutes, selectedLocation.id);
     setAvailableSlots(slots);
     setIsLoadingSlots(false);

     const availableCount = slots.filter(s => s.isAvailable).length;
     suggestAvailabilitySummary(availableCount).then(setAiSummary);
  }, [selectedDate, selectedDuration, selectedLocation]);

  useEffect(() => {
    if (currentStep === 1) {
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

      // Generazione AI Piano Lezione
      const aiPlan = await generateLessonPlan({
          sport: selectedSport.name,
          skillLevel: formData.level,
          durationMinutes: selectedDuration.minutes,
      });
      setGeneratedPlan(aiPlan);

      const newBooking: Booking = {
          id: Date.now().toString(),
          sportId: selectedSport.id,
          sportName: selectedSport.name,
          locationId: selectedLocation.id,
          locationName: selectedLocation.name,
          durationMinutes: selectedDuration.minutes,
          date: selectedDate.toISOString().split('T')[0],
          timeSlotId: selectedSlot.id,
          startTime: selectedSlot.startTime,
          customerName: formData.name,
          customerEmail: formData.email,
          skillLevel: formData.level,
          notes: formData.notes,
          aiLessonPlan: aiPlan
      };

      saveBooking(newBooking);
      setConfirmedBooking(newBooking);
      setIsSubmitting(false);
      setCurrentStep(3);
  };

  // Step 1: Configurations (Sport, Location, Duration)
  if (currentStep === 0) {
    return (
      <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="text-center space-y-3">
            <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400 tracking-tight">
                {config.homeTitle}
            </h1>
            <p className="text-lg text-slate-400 max-w-xl mx-auto leading-relaxed">
                {config.homeSubtitle}
            </p>
        </div>

        {/* Sport Selection - Solo testo, niente icone */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
            {config.sports.map(sport => (
                <button 
                    key={sport.id}
                    onClick={() => setSelectedSport(sport)}
                    className={`group relative p-6 rounded-2xl text-left transition-all duration-300 border ${selectedSport?.id === sport.id 
                        ? 'bg-indigo-600/20 border-indigo-500 shadow-[0_0_30px_rgba(79,70,229,0.15)]' 
                        : 'bg-slate-800/50 border-slate-700 hover:bg-slate-800 hover:border-slate-600 hover:-translate-y-1'}`}
                >
                    <div className="flex items-center justify-between">
                        <div>
                            <div className={`font-bold text-xl ${selectedSport?.id === sport.id ? 'text-white' : 'text-slate-200 group-hover:text-white'}`}>
                                {sport.name}
                            </div>
                            <p className="text-sm text-slate-400 mt-1 font-light">{sport.description}</p>
                        </div>
                        {selectedSport?.id === sport.id && (
                            <div className="w-6 h-6 rounded-full bg-indigo-500 text-white flex items-center justify-center shadow-lg shadow-indigo-500/50">
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"></path></svg>
                            </div>
                        )}
                    </div>
                </button>
            ))}
        </div>

        {selectedSport && (
            <div className="bg-slate-800/40 backdrop-blur border border-slate-700 rounded-2xl p-6 grid grid-cols-1 md:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-2">
                 {/* Location */}
                 <div>
                    <label className="block text-sm font-medium text-slate-400 mb-3 uppercase tracking-wider">Sede</label>
                    <select 
                        className="w-full p-4 border border-slate-600 rounded-xl bg-slate-900/50 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                        onChange={(e) => setSelectedLocation(config.locations.find(l => l.id === e.target.value) || null)}
                        value={selectedLocation?.id}
                    >
                        {config.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                 </div>

                 {/* Duration */}
                 <div>
                    <label className="block text-sm font-medium text-slate-400 mb-3 uppercase tracking-wider">Durata</label>
                    <div className="flex gap-3 flex-wrap">
                        {config.durations.map(d => (
                            <button
                                key={d.minutes}
                                onClick={() => setSelectedDuration(d)}
                                className={`flex-1 min-w-[80px] py-3 px-4 rounded-xl font-medium text-sm transition-all ${selectedDuration?.minutes === d.minutes 
                                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' 
                                    : 'bg-slate-900/50 text-slate-400 border border-slate-600 hover:border-slate-500 hover:text-white'}`}
                            >
                                {d.minutes} min
                            </button>
                        ))}
                    </div>
                 </div>
            </div>
        )}

        <div className="flex justify-center pt-4">
            <Button 
                disabled={!selectedSport || !selectedLocation || !selectedDuration} 
                onClick={() => setCurrentStep(1)}
                className="w-full md:w-auto md:min-w-[200px] text-lg"
            >
                Avanti
            </Button>
        </div>
      </div>
    );
  }

  // Step 2: Date & Time
  if (currentStep === 1) {
      return (
        <div className="space-y-6 animate-in fade-in">
            <div className="flex items-center justify-between mb-2">
                <button onClick={() => setCurrentStep(0)} className="text-slate-400 hover:text-white text-sm flex items-center gap-1 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
                    Modifica
                </button>
                <div className="text-right hidden sm:block">
                    <div className="font-bold text-white">{selectedSport?.name} @ {selectedLocation?.name}</div>
                    <div className="text-xs text-slate-400">{selectedDuration?.minutes} minuti</div>
                </div>
            </div>

            <div className="bg-slate-800/50 backdrop-blur rounded-2xl border border-slate-700 p-6 md:p-8 shadow-xl">
                {/* Date Picker Header */}
                <div className="flex items-center justify-between mb-8 bg-slate-900/50 p-4 rounded-xl border border-slate-700/50">
                    <button onClick={() => handleDateChange(-1)} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-all">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
                    </button>
                    <div className="text-center">
                        <div className="text-xl font-bold text-white capitalize">
                            {selectedDate.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}
                        </div>
                        <div className="text-sm text-indigo-400 font-medium mt-1 h-5 animate-pulse">
                            {isLoadingSlots ? 'Sto cercando...' : aiSummary}
                        </div>
                    </div>
                    <button onClick={() => handleDateChange(1)} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-all">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                    </button>
                </div>

                {/* Slots Grid */}
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                    {isLoadingSlots ? Array.from({length: 10}).map((_, i) => (
                        <div key={i} className="h-12 bg-slate-700/50 rounded-lg animate-pulse"></div>
                    )) : availableSlots.length > 0 ? availableSlots.map(slot => (
                        <button
                            key={slot.id}
                            disabled={!slot.isAvailable}
                            onClick={() => setSelectedSlot(slot)}
                            className={`py-3 px-2 rounded-xl text-sm font-medium transition-all relative overflow-hidden ${
                                selectedSlot?.id === slot.id 
                                ? 'bg-indigo-600 text-white shadow-lg ring-2 ring-indigo-400 ring-offset-2 ring-offset-slate-900' 
                                : slot.isAvailable 
                                    ? 'bg-slate-700/50 text-slate-200 hover:bg-slate-600 hover:text-white border border-slate-600/50' 
                                    : 'bg-slate-900/50 text-slate-600 cursor-not-allowed border border-transparent'
                            }`}
                        >
                            {new Date(slot.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </button>
                    )) : (
                        <div className="col-span-full text-center py-10 text-slate-500">
                            Nessuno slot disponibile per questa data.
                        </div>
                    )}
                </div>
            </div>

            <div className="flex justify-center pt-4">
                <Button 
                    disabled={!selectedSlot} 
                    onClick={() => setCurrentStep(2)}
                    className="w-full md:w-auto md:min-w-[200px]"
                >
                    Continua
                </Button>
            </div>
        </div>
      );
  }

  // Step 3: User Details
  if (currentStep === 2) {
      return (
          <div className="space-y-6 animate-in fade-in">
            <button onClick={() => setCurrentStep(1)} className="text-slate-400 hover:text-white text-sm flex items-center gap-1 transition-colors mb-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
                Indietro
            </button>
            
            <div className="bg-slate-800/50 backdrop-blur rounded-2xl border border-slate-700 p-6 md:p-8 shadow-xl">
                <h2 className="text-2xl font-bold text-white mb-6">I tuoi Dati</h2>
                <div className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Nome Completo</label>
                            <input 
                                type="text" 
                                className="w-full p-4 bg-slate-900 border border-slate-600 rounded-xl text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                value={formData.name}
                                onChange={e => setFormData({...formData, name: e.target.value})}
                                placeholder="Il tuo nome"
                            />
                        </div>
                         <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Email</label>
                            <input 
                                type="email" 
                                className="w-full p-4 bg-slate-900 border border-slate-600 rounded-xl text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                value={formData.email}
                                onChange={e => setFormData({...formData, email: e.target.value})}
                                placeholder="tu@email.com"
                            />
                        </div>
                    </div>

                    <div>
                         <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Livello di Gioco</label>
                         <div className="grid grid-cols-3 gap-3">
                             {['Beginner', 'Intermediate', 'Advanced'].map(level => (
                                 <button 
                                    key={level}
                                    onClick={() => setFormData({...formData, level: level as any})}
                                    className={`py-3 rounded-xl text-sm font-medium transition-all border ${formData.level === level 
                                        ? 'bg-indigo-600 text-white border-indigo-500' 
                                        : 'bg-slate-900 text-slate-400 border-slate-700 hover:border-slate-500'}`}
                                 >
                                     {level === 'Beginner' ? 'Principiante' : level === 'Intermediate' ? 'Intermedio' : 'Avanzato'}
                                 </button>
                             ))}
                         </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Note per l'istruttore (Opzionale)</label>
                        <textarea 
                            className="w-full p-4 bg-slate-900 border border-slate-600 rounded-xl text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all min-h-[100px]"
                            value={formData.notes}
                            onChange={e => setFormData({...formData, notes: e.target.value})}
                            placeholder="Su cosa vuoi lavorare oggi?"
                        />
                    </div>
                </div>
            </div>

             <div className="flex justify-center pt-4">
                <Button 
                    disabled={!formData.name || !formData.email} 
                    onClick={handleConfirm}
                    isLoading={isSubmitting}
                    className="w-full md:w-auto md:min-w-[250px] py-4 text-lg"
                >
                    Conferma Prenotazione
                </Button>
            </div>
          </div>
      );
  }

  // Step 4: Success
  if (currentStep === 3 && confirmedBooking) {
      return (
          <div className="text-center py-10 animate-in zoom-in duration-500">
              <div className="w-24 h-24 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-emerald-500/30">
                  <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
              </div>
              <h2 className="text-4xl font-bold text-white mb-2">Prenotazione Confermata!</h2>
              <p className="text-slate-400 mb-8">Ti abbiamo inviato una mail di conferma.</p>

              <div className="bg-slate-800/80 backdrop-blur rounded-2xl border border-slate-700 p-8 max-w-2xl mx-auto text-left shadow-2xl">
                  <div className="flex items-center gap-4 mb-6 border-b border-slate-700 pb-6">
                      <div className="bg-slate-700 p-3 rounded-lg">
                         <svg className="w-6 h-6 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                      </div>
                      <div>
                          <div className="font-bold text-white text-lg capitalize">
                              {new Date(confirmedBooking.date).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long'})}
                          </div>
                          <div className="text-indigo-400">
                              {new Date(confirmedBooking.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - {selectedDuration?.minutes} min
                          </div>
                      </div>
                  </div>

                  <div className="space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Piano di Allenamento Generato da IA</h3>
                      <div className="prose prose-invert prose-sm max-w-none bg-slate-900/50 p-6 rounded-xl border border-slate-700/50">
                         {generatedPlan.split('\n').map((line, i) => (
                             <p key={i} className={line.startsWith('**') || line.startsWith('#') ? 'font-bold text-white mt-4' : 'text-slate-300'}>
                                 {line.replace(/\*\*/g, '').replace(/#/g, '')}
                             </p>
                         ))}
                      </div>
                  </div>
              </div>
              
              <div className="mt-10">
                  <Button variant="outline" onClick={() => window.location.reload()}>Torna alla Home</Button>
              </div>
          </div>
      );
  }

  return null;
};

export default BookingFlow;
