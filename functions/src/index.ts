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
        const { articleUrl, level, title, snippet } = req.body;
        if (!articleUrl || !level || !title || !snippet) {
          res.status(400).json({error: "Missing article URL, level, title, or snippet."});
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

        let summaryText: string | null = null;
        let paywallLikely = false;

        // ---------- ATTEMPT 1: Get Article Summary via URL Context ----------
        logger.info(`Attempt 1: Fetching summary via urlContext for ${articleUrl}`);
        const urlSummaryPrompt = `Please provide a detailed, comprehensive summary of the article at this URL: ${articleUrl}. Extract key facts, names, and concepts. IMPORTANT: Also, explicitly state if the full article content seems to be behind a paywall or requires a subscription/login based on the fetched content.`;

        try {
            const urlSummaryResponse = await ai.models.generateContent({
                model: "gemini-2.5-flash", // Or your preferred model
                contents: [{ role: "user", parts: [{ text: urlSummaryPrompt }] }],
                config: {
                    tools: [{urlContext: {}}],
                    safetySettings: safetySettings,
                },
            });

            const urlSummaryText = urlSummaryResponse.text;

            if (!urlSummaryText) {
                logger.warn("Gemini urlContext response (Attempt 1) was empty.", JSON.stringify(urlSummaryResponse, null, 2));
                 // Check fetch status specifically
                 const metadata = urlSummaryResponse.candidates?.[0]?.urlContextMetadata;
                 if (metadata?.urlMetadata?.[0]?.urlRetrievalStatus !== 'URL_RETRIEVAL_STATUS_SUCCESS') {
                     logger.warn(`urlContext fetch failed (Status: ${metadata?.urlMetadata?.[0]?.urlRetrievalStatus}), proceeding to Attempt 2.`);
                     paywallLikely = true; // Treat fetch failure similar to paywall for Attempt 2
                 }
                 // If fetch succeeded but text is empty, still try Attempt 2
                 paywallLikely = true;

            } else {
                summaryText = urlSummaryText; // Store the summary
                logger.info("Attempt 1 successful. Received summary via urlContext.");

                // Check for paywall keywords in the successful summary
                const paywallKeywords = ["paywall", "subscribe", "subscription", "log in to read", "full access", "limited access", "member exclusive", "requires login", "sign in"];
                const lowerSummary = summaryText.toLowerCase();
                if (paywallKeywords.some(keyword => lowerSummary.includes(keyword))) {
                    logger.info(`Paywall likely detected in urlContext summary for ${articleUrl}. Proceeding to Attempt 2.`);
                    paywallLikely = true;
                    summaryText = null; // Discard paywalled summary
                }
            }
        } catch (urlError) {
             logger.error("Error during Attempt 1 (urlContext):", urlError);
             // Assume potential paywall or access issue, proceed to Attempt 2
             paywallLikely = true;
        }

        // ---------- ATTEMPT 2: Generate Summary via Grounding (if Attempt 1 failed or detected paywall) ----------
        if (paywallLikely && !summaryText) {
            logger.info(`Attempt 2: Generating summary via grounding using title and snippet for ${articleUrl}`);
            const groundingSummaryPrompt = `Based *only* on the following title and snippet from a news article, please generate a concise summary. Do not add external information.

            Title: "${title}"
            Snippet: "${snippet}"

            Summary:`;

             try {
                const groundingSummaryResponse = await ai.models.generateContent({
                    model: "gemini-2.5-flash", // Use a model suitable for text generation
                    contents: [{ role: "user", parts: [{ text: groundingSummaryPrompt }] }],
                    config: {
                        safetySettings: safetySettings,
                        // NO tools: urlContext needed here
                    },
                });

                const groundingSummaryText = groundingSummaryResponse.text;

                if (!groundingSummaryText) {
                     logger.error("Gemini grounding response (Attempt 2) was empty.", JSON.stringify(groundingSummaryResponse, null, 2));
                     throw new Error("Failed to generate summary from title/snippet after paywall detection.");
                } else {
                    summaryText = groundingSummaryText; // Use the grounded summary
                    logger.info("Attempt 2 successful. Received summary via grounding.");
                }
             } catch (groundingError) {
                 logger.error("Error during Attempt 2 (grounding):", groundingError);
                 throw new Error(`Failed to generate summary: ${ (groundingError as Error).message }`); // Propagate error if both attempts fail
             }
        }

        // --- Check if we have a summary after both attempts ---
        if (!summaryText) {
             // This case should ideally be caught by errors above, but as a fallback:
             throw new Error("Could not obtain a usable summary from either URL context or grounding.");
        }

        // ---------- CALL 3 (Previously Call 2): Generate Lesson from Final Summary ----------
        // This part remains mostly the same, just uses the final `summaryText`

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
              `goal is to generate structured learning material based on the content of the provided news article summary. ` +
              `The user's English level is ${level}. Provide the ` +
              `following sections in a JSON object format based *only* on the provided summary text.`;

        const lessonPrompt =
              `Generate the lesson for a ${level} English learner based on the following article summary:

              SUMMARY: "${summaryText}"

              Base the lesson *only* on this summary text. Ensure vocabulary examples come directly from the summary.`;

        logger.info("Starting final call: Generating lesson from summary.");
        const lessonResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash", // Use appropriate model
            contents: [{ role: "user", parts: [{ text: lessonPrompt }] }],
            config: {
                responseMimeType: responseMimeTypeText,
                responseSchema: responseSchemaText,
                safetySettings: safetySettings,
                systemInstruction: { parts: [{ text: systemInstructionText }] },
            },
        });

        const lessonResponseText = lessonResponse.text;

        if (!lessonResponseText) {
            logger.error("Gemini response (Lesson Gen) was empty or invalid.", JSON.stringify(lessonResponse, null, 2));
            throw new Error("Gemini response was empty while generating lesson JSON.");
        }

        const lessonJson = JSON.parse(lessonResponseText);
        // Include whether grounding was used in the response for potential debugging/UI indication
        res.status(200).json({
            success: true,
            lesson: lessonJson,
            originalArticleUrl: articleUrl,
            userId,
            summarySource: paywallLikely ? 'grounding' : 'urlContext' // Indicate summary source
        });

    } catch (e) {
        const message = (e as Error).message;
        const status = message.includes("Unauthenticated") || message.includes("Invalid") ? 401 :
                       message.includes("Generation stopped") ? 500 : // Catch safety blocks
                       500;
        logger.error("Function Error (createLesson):", e);
        res.status(status).json({error: `Lesson generation failed: ${message}`});
    }
  });