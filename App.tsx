import React, { useState, useEffect } from 'react';
import AdminDashboard from './components/AdminDashboard';
import AdminLogin from './components/AdminLogin';
import BookingFlow from './components/BookingFlow';
import { isAuthenticated } from './services/authService';
import { initConfigListener } from './services/configService';
import { initBookingListener, initGoogleClient, startAutoSync } from './services/calendarService';

const App: React.FC = () => {
  const [view, setView] = useState<'booking' | 'admin'>('booking');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // 1. Inizializza connessioni real-time con Firebase
    const unsubConfig = initConfigListener(() => {
        const unsubBookings = initBookingListener(() => {
             setIsReady(true);
        });
        return unsubBookings; 
    });

    // 2. Controllo Autenticazione
    const authStatus = isAuthenticated();
    setIsLoggedIn(authStatus);

    // 3. GLOBAL SYNC
    // Inizializza Google Client per TUTTI (anche clienti).
    // Se il calendario è pubblico (Free/Busy), l'app scaricherà gli impegni anche se a visitare è un cliente.
    initGoogleClient().then(() => {
        console.log("Google Client inizializzato. Avvio Auto-Sync...");
        startAutoSync(); 
    }).catch(err => console.warn("Errore init Google Client", err));

    // Fallback di sicurezza
    const timeout = setTimeout(() => setIsReady(true), 2500);

    return () => {
        unsubConfig();
        clearTimeout(timeout);
    };
  }, []);

  const handleAdminAccess = () => {
    if (isAuthenticated()) {
      setIsLoggedIn(true);
    }
    setView('admin');
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setView('booking');
  };

  if (!isReady) {
      return (
          <div className="min-h-screen bg-slate-950 flex items-center justify-center">
              <div className="text-center">
                  <div className="w-16 h-16 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                  <p className="text-slate-400 animate-pulse">Connessione al cloud in corso...</p>
                  <p className="text-xs text-slate-600 mt-2 max-w-xs mx-auto">Assicurati di aver inserito le chiavi Firebase in services/firebase.ts</p>
              </div>
          </div>
      );
  }

  return (
    <div className="min-h-screen flex flex-col font-sans bg-slate-950 text-slate-200 selection:bg-indigo-500 selection:text-white">
      
      {/* Decorative Background Blobs */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-900/20 rounded-full blur-[100px]"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-violet-900/20 rounded-full blur-[100px]"></div>
      </div>

      {/* Main Navbar - Glassy */}
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-slate-950/80 border-b border-slate-800/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-20">
            <div className="flex items-center cursor-pointer group" onClick={() => setView('booking')}>
              <div className="flex-shrink-0 flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-tr from-indigo-600 to-violet-600 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-indigo-500/20 group-hover:shadow-indigo-500/40 transition-all">G</div>
                <span className="font-bold text-xl text-white tracking-tight group-hover:text-indigo-200 transition-colors">Gestionale Prenotazioni</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
               {view === 'admin' && (
                 <button 
                   onClick={() => setView('booking')}
                   className="px-4 py-2 rounded-full bg-slate-800/50 text-slate-300 hover:bg-slate-700 hover:text-white text-sm font-medium transition-all"
                 >
                   ← Torna al sito
                 </button>
               )}
            </div>
          </div>
        </div>
      </nav>

      <main className="relative z-10 flex-grow w-full">
        {view === 'booking' ? (
          <div className="max-w-4xl mx-auto px-4 py-16">
            <BookingFlow />
          </div>
        ) : (
          // Admin Logic
          isLoggedIn ? (
            <AdminDashboard onLogout={handleLogout} />
          ) : (
            <AdminLogin onLoginSuccess={() => setIsLoggedIn(true)} />
          )
        )}
      </main>
      
      <footer className="relative z-10 border-t border-slate-800/50 bg-slate-950/50 text-slate-500 py-10 mt-auto">
         <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-6">
            <p className="text-sm font-medium">&copy; 2024 Gestionale Prenotazioni. <span className="opacity-50">Powered by Gemini & Firebase.</span></p>
            
            {/* Discreet Admin Access in Footer */}
            <button 
              onClick={handleAdminAccess}
              className="text-xs font-medium px-3 py-1 rounded-full border border-slate-800 hover:border-slate-600 hover:text-slate-300 transition-colors"
            >
              {isLoggedIn ? 'Dashboard Istruttore' : 'Accesso Istruttori'}
            </button>
         </div>
      </footer>
    </div>
  );
};

export default App;