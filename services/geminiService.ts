import { GoogleGenAI } from "@google/genai";
import { LessonPlanRequest } from "../types";

// Initialize Gemini Client
// Ensure process.env.API_KEY is available in your environment
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

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

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        temperature: 0.7,
      }
    });

    return response.text || "Impossibile generare il piano di lezione al momento.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Si è verificato un errore durante la generazione del piano di lezione con l'IA.";
  }
};

export const suggestAvailabilitySummary = async (slots: number): Promise<string> => {
    // Uses Gemini to generate a friendly message about availability
    const prompt = `
        Ho ${slots} slot liberi per lezioni di tennis/padel oggi.
        Genera una breve frase accattivante (max 15 parole) per invitare gli studenti a prenotare subito, sottolineando l'urgenza se sono pochi o l'opportunità se sono tanti. In Italiano.
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });
        return response.text || "Prenota ora la tua lezione!";
    } catch (e) {
        return "Prenota ora la tua lezione!";
    }
}