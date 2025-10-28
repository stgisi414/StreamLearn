import * as functions from "firebase-functions";
import {onRequest} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import fetch, { RequestInit } from "node-fetch"; // For fetchNews
import { GoogleGenAI, HarmCategory, HarmBlockThreshold, Type } from "@google/genai";
import * as logger from "firebase-functions/logger";

interface NewsResult {
    title: string;
    snippet: string;
    link: string;
    source: string;
    date: string;
}

// --- Firebase Admin Helper ---
// Initialize Admin SDK only once
if (admin.apps.length === 0) {
    admin.initializeApp();
}

async function getAuthenticatedUid(req: functions.https.Request): Promise<string> {
    const authorization = req.headers.authorization;
    const idToken = authorization?.split('Bearer ')[1];
    if (!idToken) { throw new Error("Missing or malformed Authorization header."); }
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        return decodedToken.uid;
    } catch (e) {
        logger.error("Token Verification Failed:", e);
        throw new Error("Invalid or expired authentication token.");
    }
}

// --- fetchNews Function ---
const SCRAPER_API_ENDPOINT = "https://api.brightdata.com/request"; // Define constant needed here

export const fetchNews = onRequest(
  {secrets: ["BRIGHTDATA_API_KEY", "BRIGHTDATA_SERP_ZONE_NAME"], cors: true},
  async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
      try {
        await getAuthenticatedUid(req);
        const { query, languageCode = "en" } = req.body;
        if (!query) {
          res.status(400).json({error: "The 'query' parameter is required."});
          return;
        }

        const apiKey = process.env.BRIGHTDATA_API_KEY;
        const zoneName = process.env.BRIGHTDATA_SERP_ZONE_NAME;
        if (!apiKey || !zoneName) {
            logger.error("Secret Configuration Error: SERP API secrets missing.");
            res.status(500).json({error: "Server configuration error."});
            return;
        }

        const targetUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=${languageCode}&tbm=nws&brd_json=1`;

        const payload = {
          zone: zoneName,
          url: targetUrl,
          format: "json"
        };

        const response = await fetch(SCRAPER_API_ENDPOINT, { // Using imported fetch
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        } as RequestInit); // Using imported RequestInit

        if (!response.ok) {
          const errorText = await response.text();
          logger.error("Bright Data SERP API Error (fetchNews):", response.status, errorText);
          res.status(response.status).json({ error: "Bright Data SERP API returned an error.", details: errorText });
          return;
        }

        const apiResponse: any = await response.json();
        // logger.info("Full Bright Data Response (fetchNews):", JSON.stringify(apiResponse)); // Optional debug log

        let parsedBody: any;
        try {
            if (typeof apiResponse.body !== 'string') {
                if(typeof apiResponse.news === 'object') {
                    parsedBody = apiResponse;
                    logger.info("Received direct JSON body from Bright Data.");
                } else {
                    throw new Error(`API response body is not a string or expected JSON object. Type: ${typeof apiResponse.body}`);
                }
            } else {
                 parsedBody = JSON.parse(apiResponse.body);
            }
        } catch (parseError) {
            logger.error("Failed to parse Bright Data response body:", parseError, "Body:", apiResponse.body);
            res.status(500).json({ error: "Failed to parse API response body." });
            return;
        }

        const newsResults = parsedBody.news || [];
        logger.info(`Received ${newsResults.length} structured articles from parsed body.`);

        res.status(200).json(newsResults.map((item: any) => ({
          title: item.title,
          snippet: item.description || item.snippet || '',
          link: item.link,
          source: item.source || new URL(item.link).hostname.replace(/^www\./, ''),
          date: item.date,
        })).filter((item: NewsResult) => item.title && item.link)); // Type check here

      } catch (error) {
        const message = (error as Error).message;
        const status = message.includes("Unauthenticated") || message.includes("Invalid") ? 401 : 500;
        logger.error("Function Error (fetchNews):", error);
        res.status(status).json({error: message});
      }
  });


// ----------------------------------------------------------------------
// FINAL CORRECTED CLOUD FUNCTION 2: createLesson
// (This replaces your existing createLesson function)
// ----------------------------------------------------------------------
export const createLesson = onRequest(
  {secrets: ["GEMINI_API_KEY"], timeoutSeconds: 120, cors: true},
  async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    try {
        const userId = await getAuthenticatedUid(req);
        const { articleUrl, level } = req.body;
        if (!articleUrl || !level) {
          res.status(400).json({error: "Missing article URL or level."});
          return;
        }

        const geminiApiKey = process.env.GEMINI_API_KEY;
        if (!geminiApiKey) {
            logger.error("Secret Configuration Error: GEMINI_API_KEY missing.");
            res.status(500).json({error: "Server configuration error."});
            return;
        }

        // --- USE SERVER-SIDE SDK ---
        const ai = new GoogleGenAI({apiKey: geminiApiKey});

        // ---------- CALL 1: Get Article Summary ----------

        const safetySettings = [
		    {
		        "category": HarmCategory.HARM_CATEGORY_HARASSMENT,
		        "threshold": HarmBlockThreshold.BLOCK_NONE
		    },
		    {
		        "category": HarmCategory.HARM_CATEGORY_HATE_SPEECH,
		        "threshold": HarmBlockThreshold.BLOCK_NONE
		    },
		    {
		        "category": HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
		        "threshold": HarmBlockThreshold.BLOCK_NONE
		    },
		    {
		        "category": HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
		        "threshold": HarmBlockThreshold.BLOCK_NONE
		    },
		];

        logger.info(`Starting Call 1: Fetching summary for ${articleUrl}`);
        const summaryPrompt = `Please provide a detailed, comprehensive summary of the article at this URL: ${articleUrl}. Extract key facts, names, and concepts.`;

        const summaryResponse = await ai.models.generateContent({
        	model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: summaryPrompt }] }],
            config: {
                tools: [{urlContext: {}}], // Enable URL fetching
                safetySettings: safetySettings,
                // {googleSearch: {}} // You can also add googleSearch if needed
            },
        });

        const summaryText = summaryResponse.text;

        // --- Error handling for Call 1 ---
        if (!summaryText) {
            logger.error("Gemini response (Call 1) was empty or invalid.", JSON.stringify(summaryResponse, null, 2));
            const metadata = summaryResponse.candidates?.[0]?.urlContextMetadata;
            let fetchErrorMessage = "Gemini response was empty (Call 1).";

            if (metadata && metadata.urlMetadata && metadata.urlMetadata.length > 0) {
                const status = metadata.urlMetadata[0].urlRetrievalStatus;
                if (status !== 'URL_RETRIEVAL_STATUS_SUCCESS') {
                   fetchErrorMessage = `Gemini failed to fetch URL (${articleUrl}). Status: ${status}`;
                   logger.error(fetchErrorMessage, metadata);
                }
            }
            throw new Error(fetchErrorMessage);
        }

        logger.info("Call 1 successful. Received summary.");

        // ---------- CALL 2: Generate Lesson from Summary ----------

        const responseMimeTypeText = "application/json";
        const responseSchemaText = {
            type: Type.OBJECT,
            properties: {
              articleTitle: { type: Type.STRING, description: "The title of the article fetched from the URL." },
              vocabularyList: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    word: {type: Type.STRING},
                    definition: {type: Type.STRING},
                    articleExample: {type: Type.STRING, description: "A sentence from the article using the word."},
                  },
                  required: ["word", "definition", "articleExample"],
                },
                 description: "A list of key vocabulary words from the article with definitions and example sentences from the text."
               },
              comprehensionQuestions: { type: "ARRAY", items: {type: Type.STRING}, description: "Questions to check understanding of the article."},
              grammarFocus: {
                type: Type.OBJECT,
                properties: {
                  topic: {type: Type.STRING},
                  explanation: {type: Type.STRING},
                },
                required: ["topic", "explanation"],
                description: "A specific grammar point highlighted in the article, with an explanation."
              },
            },
            required: ["articleTitle", "vocabularyList", "comprehensionQuestions", "grammarFocus"],
        };

        const systemInstructionText =
              `You are an expert English language teaching assistant. Your ` +
              `goal is to generate structured learning material based on the content of the provided news article URL. ` +
              `The user's English level is ${level}. Provide the ` +
              `following sections in a JSON object format based *only* on the article content fetched from the URL.`;

        const lessonPrompt =
              `Generate the lesson for a ${level} English learner based on the following article summary:

              SUMMARY: "${summaryText}"

              Base the lesson *only* on this text.`;

        logger.info("Starting Call 2: Generating lesson from summary.");

        // --- This call uses JSON schema, *not* urlContext ---
        const lessonResponse = await ai.models.generateContent({
        	model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: lessonPrompt }] }],
            config: {
                responseMimeType: responseMimeTypeText,
                responseSchema: responseSchemaText,
                safetySettings: safetySettings,
                systemInstruction: { parts: [{ text: systemInstructionText }] },
                // NO tools: [{urlContext: {}}] here
            },
        });

        const lessonResponseText = lessonResponse.text;

        if (!lessonResponseText) {
            logger.error("Gemini response (Call 2) was empty or invalid.", JSON.stringify(lessonResponse, null, 2));
            throw new Error("Gemini response was empty while generating lesson JSON.");
        }

        const lessonJson = JSON.parse(lessonResponseText);
        res.status(200).json({ success: true, lesson: lessonJson, originalArticleUrl: articleUrl, userId });

    } catch (e) {
        const message = (e as Error).message;
        const status = message.includes("Unauthenticated") || message.includes("Invalid") ? 401 :
                       message.includes("Generation stopped") ? 500 : // Catch safety blocks
                       500;
        logger.error("Function Error (createLesson):", e);
        res.status(status).json({error: `Lesson generation failed: ${message}`});
    }
  });