
import { GoogleGenAI, Type } from "@google/genai";
import { EnglishLevel, Lesson } from '../types';

// IMPORTANT: In a production application, the API key and this entire logic
// should be handled on a secure backend server to protect the key and manage quotas.
// The API key is accessed via `process.env.API_KEY`, which is assumed to be configured
// in the execution environment.

const lessonSchema = {
    type: Type.OBJECT,
    properties: {
        vocabulary: {
            type: Type.ARRAY,
            description: "A list of 5-10 key words or phrases from the text.",
            items: {
                type: Type.OBJECT,
                properties: {
                    word: {
                        type: Type.STRING,
                        description: "The vocabulary word or phrase.",
                    },
                    definition: {
                        type: Type.STRING,
                        description: "A simple definition of the word, tailored to the user's English level.",
                    },
                    example: {
                        type: Type.STRING,
                        description: "An example sentence using the word, taken directly from the article.",
                    },
                },
                required: ["word", "definition", "example"],
            },
        },
        comprehensionQuestions: {
            type: Type.ARRAY,
            description: "Three questions to test understanding of the article's main points.",
            items: {
                type: Type.STRING,
            },
        },
        grammarPoint: {
            type: Type.OBJECT,
            description: "A simple grammar point observed in the text.",
            properties: {
                title: {
                    type: Type.STRING,
                    description: "The name of the grammar point (e.g., 'Use of Passive Voice').",
                },
                explanation: {
                    type: Type.STRING,
                    description: "A brief explanation of the grammar point, suitable for the user's level.",
                },
            },
            required: ["title", "explanation"],
        },
    },
    required: ["vocabulary", "comprehensionQuestions", "grammarPoint"],
};

export const generateLesson = async (content: string, level: EnglishLevel): Promise<Lesson> => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        const systemInstruction = `You are an expert English language teaching assistant. Your task is to analyze a news article and generate learning materials tailored to a user's specified English level.

        Based on the provided news article text and the user's level ("${level}"), generate the following materials in a valid JSON format:
        1.  A vocabulary list: Identify 5-10 key words or phrases. For each, provide a simple definition appropriate for the user's level and one example sentence using the word *exactly as it appears in the article*.
        2.  Three comprehension questions: These questions should test the user's understanding of the article's main points and be of appropriate difficulty for their level.
        3.  One simple grammar point: Identify a relevant grammar concept observed in the text (e.g., 'Use of Passive Voice', 'Conditional Sentence Example'). Provide a brief, clear explanation suitable for the user's level.
        
        Strictly adhere to the provided JSON schema for your response.`;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: content,
            config: {
                systemInstruction: systemInstruction,
                responseMimeType: "application/json",
                responseSchema: lessonSchema,
                temperature: 0.7,
            },
        });

        const jsonText = response.text.trim();
        const lessonData: Lesson = JSON.parse(jsonText);
        return lessonData;

    } catch (error) {
        console.error("Error generating lesson with Gemini API:", error);
        throw new Error("Failed to generate lesson. The model may be unavailable or the content could not be processed.");
    }
};
