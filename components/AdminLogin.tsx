
import React, { useState } from 'react';
import { login } from '../services/authService';
import Button from './Button';

interface AdminLoginProps {
  onLoginSuccess: () => void;
}

const AdminLogin: React.FC<AdminLoginProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (login(email, password)) {
      onLoginSuccess();
    } else {
      setError('Credenziali non valide. Riprova.');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="w-full max-w-md bg-slate-800/80 backdrop-blur p-8 rounded-2xl border border-slate-700 shadow-2xl">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-slate-700 text-indigo-400 rounded-full flex items-center justify-center mx-auto mb-4 shadow-inner">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
          </div>
          <h2 className="text-2xl font-bold text-white">Area Riservata</h2>
          <p className="text-slate-400 mt-2">Accesso istruttori</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Email</label>
            <input 
              type="email" 
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(''); }}
              className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-xl text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder-slate-600"
              placeholder="nome@email.com"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Password</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-xl text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder-slate-600"
              placeholder="Inserisci la password"
            />
            {error && <p className="text-red-400 text-sm mt-2 animate-pulse">{error}</p>}
          </div>
          <Button type="submit" className="w-full py-3 text-lg">Accedi</Button>
        </form>
        
        <div className="mt-6 text-center opacity-50 hover:opacity-100 transition-opacity">
            <p className="text-xs text-slate-600">
                Credenziali Demo disponibili
            </p>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;
