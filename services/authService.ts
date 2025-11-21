
const AUTH_KEY = 'courtmaster_auth_session';

export const isAuthenticated = (): boolean => {
  return localStorage.getItem(AUTH_KEY) === 'true';
};

export const login = (email: string, password: string): boolean => {
  // Controllo delle credenziali specifiche richieste
  if (email.toLowerCase() === 'vacinaletti93@hotmail.it' && password === 'password') {
    localStorage.setItem(AUTH_KEY, 'true');
    return true;
  }
  return false;
};

export const logout = () => {
  localStorage.removeItem(AUTH_KEY);
};
