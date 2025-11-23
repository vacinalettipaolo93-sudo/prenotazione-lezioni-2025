import { GoogleGenAI } from "@google/genai";
import { LessonPlanRequest } from "../types";

// API Key fornita dall'utente
// NOTA: Se ricevi errori "PermissionDenied" o 403, verifica che questa chiave 
// abbia "Generative Language API" abilitata in Google Cloud Console.
const API_KEY = 'AIzaSyAv_qusWIgR7g2C1w1MeLyCNQNghZg9sWA';

const ai = new GoogleGenAI({ apiKey: API_KEY });

export const generateLessonPlan = async (request: LessonPlanRequest): Promise<string> => {
  try {
    const prompt = `
      Sei un allenatore esperto di ${request.sport} di livello mondiale.
      Crea un piano di lezione sintetico e strutturato per un giocatore di livello ${request.skillLevel}.
      Durata lezione: ${request.durationMinutes} minuti.
      
      Struttura richiesta (usa Markdown):
      1. Riscaldamento (specifico per ${request.sport})
      2. Focus Tecnico/Tattico principale
      3. Esercizi (Drills) con descrizione breve
      4. Defaticamento/Cool-down
      
      Tono: Motivante e professionale. Rispondi in Italiano.
    `;

    // Utilizziamo gemini-2.5-flash per task testuali rapidi
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        temperature: 0.7,
      }
    });

    return response.text || "";
  } catch (error: any) {
    console.error("Gemini API Error - Dettagli:", error);
    // In caso di errore, restituiamo stringa vuota per nascondere la sezione nell'UI
    return "";
  }
};

export const suggestAvailabilitySummary = async (slots: number): Promise<string> => {
    const prompt = `
        Ho ${slots} slot liberi per lezioni di tennis/padel oggi.
        Genera una breve frase accattivante (max 15 parole) per invitare gli studenti a prenotare subito. In Italiano.
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });
        return response.text || "Prenota ora la tua lezione!";
    } catch (e) {
        // Fallback silenzioso per la summary
        return "Prenota ora la tua lezione!";
    }
}