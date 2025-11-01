// stgisi414/streamlearn/StreamLearn-9282341a63ce7e0d409702bc90f81e24e5098e1e/functions/src/index.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import * as functions from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import "firebase-admin/functions";
import fetch, { RequestInit } from "node-fetch"; // For fetchNews
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { GoogleGenAI, HarmCategory, HarmBlockThreshold, Type, Modality, MediaResolution } from "@google/genai";
import * as logger from "firebase-functions/logger";
import * as TextToSpeech from '@google-cloud/text-to-speech';

type LanguageCode = "en" | "es" | "fr" | "de" | "it" | "ko" | "ja" | "zh";

interface NewsResult {
    title: string;
    snippet: string;
    link: string;
    source: string;
    date: string;
    image?: string;
}

// --- Firebase Admin Helper ---
// Initialize Admin SDK only once
if (admin.apps.length === 0) {
    admin.initializeApp();
}

async function getAuthenticatedUid(req: functions.https.Request): Promise<string> {
    const authorization = req.headers.authorization;
    // FIX: Check for 'x-forwarded-authorization' as well for App Hosting
    const idToken = authorization?.split('Bearer ')[1] || (req.headers['x-forwarded-authorization'] as string)?.split('Bearer ')[1];
    
    if (!idToken) { 
      logger.error("Missing or malformed Authorization header.", {
          authHeader: authorization,
          xForwardedAuthHeader: req.headers['x-forwarded-authorization']
      });
      throw new Error("Missing or malformed Authorization header."); 
    }
    
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        return decodedToken.uid;
    } catch (e) {
        logger.error("Token Verification Failed:", e, { idToken: idToken.substring(0, 10) + "..." });
        throw new Error("Invalid or expired authentication token.");
    }
}


const FREE_LESSON_LIMIT = 25;

/**
 * Checks a user's subscription status and lesson usage.
 */
async function checkUsageAndSubscription(userId: string): Promise<{
  canCreate: boolean;
  isSubscribed: boolean;
  message: string;
}> {
  const db = admin.firestore();
  
  // 1. Check for an active subscription
  try {
    // FIX: Use 'customers' collection per your firestore.rules
    const subscriptionsRef = db.collection(`customers/${userId}/subscriptions`);
    const activeSubSnapshot = await subscriptionsRef
                                .where("status", "in", ["active", "trialing"])
                                .limit(1)
                                .get();

    if (!activeSubSnapshot.empty) {
      logger.info(`User ${userId} has an active subscription.`);
      return { canCreate: true, isSubscribed: true, message: "Subscribed user." };
    }
  } catch (err) {
    logger.error(`Error checking subscription for ${userId}:`, err);
    // Don't block creation, just log the error and proceed as a free user
  }

  // 2. If no subscription, check free tier usage
  logger.info(`User ${userId} is a free user. Checking usage limit.`);
  const currentMonth = new Date().toISOString().slice(0, 7); // Format: "YYYY-MM"
  
  // FIX: Use 'users' collection per your firestore.rules
  const usageRef = db.doc(`users/${userId}/usage/${currentMonth}`);
  
  try {
    const usageDoc = await usageRef.get();
    const lessonCount = usageDoc.exists ? (usageDoc.data()?.lessonCount || 0) : 0;

    if (lessonCount >= FREE_LESSON_LIMIT) {
      logger.warn(`User ${userId} has reached free limit of ${FREE_LESSON_LIMIT} lessons for ${currentMonth}.`);
      return { 
        canCreate: false, 
        isSubscribed: false, 
        message: `You have used all ${FREE_LESSON_LIMIT} of your free lessons for this month. Please upgrade to create more.` 
      };
    }

    logger.info(`User ${userId} has used ${lessonCount}/${FREE_LESSON_LIMIT} lessons.`);
    return { canCreate: true, isSubscribed: false, message: `Free user. ${lessonCount}/${FREE_LESSON_LIMIT} lessons used.` };

  } catch (err) {
    logger.error(`Error checking usage for ${userId}:`, err);
    // Fail safe: If we can't check usage, block creation to prevent abuse
    return { canCreate: false, isSubscribed: false, message: "Could not verify your lesson usage. Please try again." };
  }
}

/**
 * Increments the lesson count for a free user.
 */
async function incrementLessonUsage(userId: string) {
  const db = admin.firestore();
  const currentMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  
  // FIX: Use 'users' collection per your firestore.rules
  const usageRef = db.doc(`users/${userId}/usage/${currentMonth}`);

  try {
    await usageRef.set({
      lessonCount: admin.firestore.FieldValue.increment(1)
    }, { merge: true });
    logger.info(`Incremented lesson count for user ${userId} for month ${currentMonth}.`);
  } catch (err) {
    logger.error(`Failed to increment usage for ${userId}:`, err);
  }
}

// --- fetchNews Function ---
const SCRAPER_API_ENDPOINT = "https://api.brightdata.com/request"; // Define constant needed here

export const fetchNews = onRequest(
  {secrets: ["BRIGHTDATA_API_KEY", "BRIGHTDATA_SERP_ZONE_NAME"], cors: true, region: 'us-central1'},
  async (req, res) => {
      // Set CORS headers for all responses
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (req.method === 'OPTIONS') { 
        res.status(204).send(''); 
        return; 
      }
      
      try {
        const userId = await getAuthenticatedUid(req);
        logger.info(`fetchNews: Authenticated user ${userId}.`);
        const { query, languageCode = "en" } = req.body.data;
        if (!query) {
          logger.error("fetchNews: Bad request, 'query' is required.");
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
        logger.info(`fetchNews: Target URL: ${targetUrl}`);

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

        const formattedResults = newsResults.map((item: any) => ({
          title: item.title,
          snippet: item.description || item.snippet || '',
          link: item.link,
          source: item.source || new URL(item.link).hostname.replace(/^www\./, ''),
          date: item.date,
          image: item.image || undefined
        })).filter((item: NewsResult) => item.title && item.link);

        res.status(200).json({ data: formattedResults });

      } catch (error) {
        const message = (error as Error).message;
        const status = message.includes("Unauthenticated") || message.includes("Invalid") ? 401 : 500;
        logger.error("Function Error (fetchNews):", error);
        res.status(status).json({error: message});
      }
  });

/**
 * Maps app language codes to full language names for prompts.
 */
function getLanguageName(code: LanguageCode | string): string {
  switch (code) {
    case "en": return "English";
    case "es": return "Spanish";
    case "fr": return "French";
    case "de": return "German";
    case "it": return "Italian";
    case "ko": return "Korean";
    case "ja": return "Japanese";
    case "zh": return "Chinese";
    default: return "English"; // Fallback
  }
}

/**
 * Maps app language codes to Google Cloud TTS language codes.
 */
function getGoogleTTSLangCode(code: LanguageCode | string): string {
  switch (code) {
    case "en": return "en-US";
    case "es": return "es-US"; // Or es-ES
    case "fr": return "fr-FR";
    case "de": return "de-DE";
    case "it": return "it-IT";
    case "ko": return "ko-KR";
    case "ja": return "ja-JP";
    case "zh": return "cmn-CN"; // Mandarin
    default: return "en-US";
  }
}

// ----------------------------------------------------------------------
// FINAL CORRECTED CLOUD FUNCTION 2: createLesson
// ----------------------------------------------------------------------
export const createLesson = onRequest(
  {secrets: ["GEMINI_API_KEY"], timeoutSeconds: 120, cors: true, region: 'us-central1'},
  async (req, res) => {
    // Set CORS headers for all responses
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') { 
      res.status(204).send(''); 
      return; 
    }
    
    try {
        const userId = await getAuthenticatedUid(req);
        logger.info(`createLesson: Authenticated user ${userId}.`);
        const { canCreate, isSubscribed, message } = await checkUsageAndSubscription(userId);
        if (!canCreate) {
          logger.warn(`createLesson: User ${userId} cannot create lesson. Reason: ${message}`);
          res.status(402).json({ error: message });
          return;
        }
        
        const { articleUrl, level, title, snippet, uiLanguage = "en", targetLanguage = "en" } = req.body.data;
        if (!articleUrl || !title) {
          logger.error("createLesson: Bad request, missing articleUrl or title.");
          res.status(400).json({error: "Missing article URL and title."});
          return;
        }

        const geminiApiKey = process.env.GEMINI_API_KEY;
        if (!geminiApiKey) {
            logger.error("Secret Configuration Error: GEMINI_API_KEY missing.");
            res.status(500).json({error: "Server configuration error."});
            return;
        }

        const ai = new GoogleGenAI({apiKey: geminiApiKey});

        const safetySettings = [
            { "category": HarmCategory.HARM_CATEGORY_HARASSMENT, "threshold": HarmBlockThreshold.BLOCK_NONE },
            { "category": HarmCategory.HARM_CATEGORY_HATE_SPEECH, "threshold": HarmBlockThreshold.BLOCK_NONE },
            { "category": HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, "threshold": HarmBlockThreshold.BLOCK_NONE },
            { "category": HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, "threshold": HarmBlockThreshold.BLOCK_NONE },
        ];

        let summaryText: string | null = null;
        let paywallLikely = false;
        let summarySource = "unknown"; // To track origin

        const uiLangName = getLanguageName(uiLanguage);
        const targetLangName = getLanguageName(targetLanguage);

        logger.info(`Attempt 1: Fetching summary via urlContext for ${articleUrl}`);
        const urlSummaryPrompt = `Act as a news reporter. Report the key facts, events, and information from the content at this URL: ${articleUrl} IN ${targetLangName.toUpperCase()}. 
            Your report should be between 5 and 10 sentences long. 
            Do not use words like 'article', 'summary', or 'this text' in ${targetLangName}. Report the information directly.
            IMPORTANT: After your news report, on a new line, in ENGLISH, explicitly state "PAYWALL_DETECTED" if the full content seems to be behind a paywall or requires a subscription/login based on the fetched content. If no paywall is obvious, state "PAYWALL_NOT_DETECTED".`;

        try {
            const urlSummaryResponse = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: [{ role: "user", parts: [{ text: urlSummaryPrompt }] }],
                config: {
                    tools: [{urlContext: {}}],
                    safetySettings: safetySettings,
                },
            });

            // Use .text accessor
            const urlSummaryText = urlSummaryResponse.text;

            if (!urlSummaryText) {
                logger.warn("Gemini urlContext response (Attempt 1) was empty.", JSON.stringify(urlSummaryResponse, null, 2));
                 const metadata = urlSummaryResponse.candidates?.[0]?.urlContextMetadata;
                 if (metadata?.urlMetadata?.[0]?.urlRetrievalStatus !== 'URL_RETRIEVAL_STATUS_SUCCESS') {
                     logger.warn(`urlContext fetch failed (Status: ${metadata?.urlMetadata?.[0]?.urlRetrievalStatus}), proceeding to Attempt 2.`);
                     paywallLikely = true;
                 }
                 paywallLikely = true;

            } else {
                summaryText = urlSummaryText; 
                logger.info("Attempt 1 successful. Received summary via urlContext.");
                summarySource = "urlContext";

                const paywallKeywords = ["paywall", "subscribe", "subscription", "log in to read", "full access", "limited access", "member exclusive", "requires login", "sign in"];
                const lowerSummary = summaryText.toLowerCase();
                if (paywallKeywords.some(keyword => lowerSummary.includes(keyword)) || lowerSummary.includes("paywall_detected")) {
                    logger.info(`Paywall likely detected in urlContext summary for ${articleUrl}. Proceeding to Attempt 2.`);
                    paywallLikely = true;
                    summaryText = null; // Discard paywalled summary
                    summarySource = "unknown";
                }
            }
        } catch (urlError) {
             logger.error("Error during Attempt 1 (urlContext):", urlError);
             paywallLikely = true;
        }

        if (paywallLikely && !summaryText) {
            logger.info(`Attempt 2: Generating summary via grounding for ${articleUrl}`);
            summarySource = "grounding"; // Set source

            let groundingSummaryPrompt = `You are a news reporter. Based *only* on the following title`;
            if (snippet && snippet.trim() !== "") {
                groundingSummaryPrompt += ` and snippet`;
            }
            groundingSummaryPrompt += `, write a news report in ${targetLangName.toUpperCase()}.
                The report must be 5 to 10 sentences long. 
                Do not add external information. Do not use words like 'article' or 'summary' in ${targetLangName}. Report the information directly.
                Title: "${title}"`;
            if (snippet && snippet.trim() !== "") {
                groundingSummaryPrompt += `\nSnippet: "${snippet}"`;
            }
            groundingSummaryPrompt += `\n\nNews Report (in ${targetLangName}):`;

             try {
                const groundingSummaryResponse = await ai.models.generateContent({
                    model: "gemini-2.5-flash", 
                    contents: [{ role: "user", parts: [{ text: groundingSummaryPrompt }] }],
                    config: {
                        safetySettings: safetySettings,
                    },
                });

                // Use .text accessor
                const groundingSummaryText = groundingSummaryResponse.text;

                if (!groundingSummaryText) {
                     logger.error("Gemini grounding response (Attempt 2) was empty.", JSON.stringify(groundingSummaryResponse, null, 2));
                     throw new Error("Failed to generate summary from title/snippet after paywall detection.");
                } else {
                    summaryText = groundingSummaryText; 
                    logger.info("Attempt 2 successful. Received summary via grounding.");
                }
             } catch (groundingError) {
                 logger.error("Error during Attempt 2 (grounding):", groundingError);
                 throw new Error(`Failed to generate summary: ${ (groundingError as Error).message }`);
             }
        }

        if (!summaryText) {
             throw new Error("Could not obtain a usable summary from either URL context or grounding.");
        }

        // Clean up the paywall detector text if it's still there
        summaryText = summaryText.replace(/PAYWALL_DETECTED/g, "").replace(/PAYWALL_NOT_DETECTED/g, "").trim();

        const responseMimeTypeText = "application/json";
        const responseSchemaText = {
            type: Type.OBJECT,
            properties: {
              articleTitle: { type: Type.STRING, description: `The title of the news item, in ${targetLangName}.` },
              summary: { type: Type.STRING, description: `The detailed news report, in ${targetLangName}.` },
              vocabularyList: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    word: {type: Type.STRING, description: `A key ${targetLangName} word from the report.`},
                    definition: {type: Type.STRING, description: `A clear, concise definition of the word, written in ${uiLangName.toUpperCase()}.`},
                    articleExample: {type: Type.STRING, description: `A sentence from the report text (in ${targetLangName}) using the word.`},
                  },
                  required: ["word", "definition", "articleExample"],
                },
                 description: `A list of key ${targetLangName} vocabulary words from the news report.`
               },
              comprehensionQuestions: { type: "ARRAY", items: {type: Type.STRING}, description: `Questions (in ${uiLangName.toUpperCase()}) to check understanding of the news report.`},
              grammarFocus: {
                type: Type.OBJECT,
                properties: {
                  topic: {type: Type.STRING, description: `The name of the ${targetLangName} grammar topic (e.g., 'Past Tense').`},
                  explanation: {type: Type.STRING, description: `A clear explanation of this grammar topic, written in ${uiLangName.toUpperCase()}.`},
                },
                required: ["topic", "explanation"],
                description: `A specific ${targetLangName} grammar point highlighted in the report, with an explanation in ${uiLangName.toUpperCase()}.`
              },
            },
            required: ["articleTitle", "summary", "vocabularyList", "comprehensionQuestions", "grammarFocus"],
        };

        const systemInstructionText =
            `You are an expert ${targetLangName} language teacher creating a lesson for a ${uiLangName}-speaking student. 
            Your student's ${targetLangName} level is ${level}. 
            Your goal is to generate structured learning material based *only* on the content of the provided ${targetLangName} news report.
            You MUST provide the following sections in a JSON object format.
            - All definitions and explanations (like vocabulary definitions, grammar explanations, and comprehension questions) MUST be in ${uiLangName.toUpperCase()}.
            - All content from the article (like the summary, vocabulary words, and example sentences) MUST be in ${targetLangName.toUpperCase()}.
            
            The "grammarFocus.explanation" must be rich text using Markdown, including headings, ordered lists, and bold text for clarity and structure.`;

        const lessonPrompt =
            `Generate the lesson for my ${level} ${uiLangName}-speaking student who is learning ${targetLangName}.
            Generate the lesson based *only* on the following news report:

            REPORT (in ${targetLangName}): "${summaryText}"

            Your JSON output must include:
            1. "articleTitle": The original title (in ${targetLangName}).
            2. "summary": The detailed news report text provided above (in ${targetLangName}).
            3. "vocabularyList": Key ${targetLangName} words, with definitions in ${uiLangName.toUpperCase()} and example sentences from the report (in ${targetLangName}).
            4. "comprehensionQuestions": Questions about the report, written in ${uiLangName.toUpperCase()}.
            5. "grammarFocus": A ${targetLangName} grammar topic found in the report, with an explanation in ${uiLangName.toUpperCase()}.

            Ensure vocabulary examples come directly from the report text.`;

        logger.info("Starting final call: Generating lesson from summary.");
        const lessonResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash", 
            contents: [{ role: "user", parts: [{ text: lessonPrompt }] }],
            config: {
                responseMimeType: responseMimeTypeText,
                responseSchema: responseSchemaText,
                safetySettings: safetySettings,
                systemInstruction: { parts: [{ text: systemInstructionText }] },
            },
        });

        // Use .text accessor
        const lessonResponseText = lessonResponse.text;

        if (!lessonResponseText) {
            logger.error("Gemini response (Lesson Gen) was empty or invalid.", JSON.stringify(lessonResponse, null, 2));
            throw new Error("Gemini response was empty while generating lesson JSON.");
        }

        if (!isSubscribed) {
          await incrementLessonUsage(userId);
        }

        const lessonJson = JSON.parse(lessonResponseText);
        
        // --- FIX: Add the summary to the lessonJson object ---
        // The prompt asks for it, but let's be 100% sure it's the one we used.
        lessonJson.summary = summaryText;
        // --- END FIX ---

        res.status(200).json({
            data: { 
                success: true,
                lesson: lessonJson,
                originalArticleUrl: articleUrl,
                userId,
                summarySource: summarySource
            }
        });

    } catch (e) {
        const message = (e as Error).message;
        const status = message.includes("Unauthenticated") || message.includes("Invalid") ? 401 :
                       message.includes("Generation stopped") ? 500 : 
                       500;
        logger.error("Function Error (createLesson):", e);
        res.status(status).json({error: `Lesson generation failed: ${message}`});
    }
  });

// --- NEW: handleActivity Function ---
export const handleActivity = onRequest(
  { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 120, cors: true, region: 'us-central1' },
  async (req, res) => {
    // Set CORS headers for all responses
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') { 
      res.status(204).send(''); 
      return; 
    }

    try {
      await getAuthenticatedUid(req); // Authenticate the request
      
      const { activityType, payload } = req.body.data;
      const { 
        level = "Intermediate",
        uiLanguage = "en",
        targetLanguage = "en" 
      } = payload; 

      const uiLangName = getLanguageName(uiLanguage);
      const targetLangName = getLanguageName(targetLanguage);

      if (!activityType || !payload) {
        logger.error("handleActivity: Bad request, missing activityType or payload.");
        res.status(400).json({ error: "Missing activityType or payload." });
        return;
      }

      const geminiApiKey = process.env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        logger.error("Secret Configuration Error: GEMINI_API_KEY missing.");
        res.status(500).json({ error: "Server configuration error." });
        return;
      }

      const ai = new GoogleGenAI({ apiKey: geminiApiKey });

      const safetySettings = [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ];


      let prompt = "";
      let responseSchema: any = null;

      switch (activityType) {
        case 'vocab':
          if (!payload.word || !payload.userAnswer) {
             logger.error("handleActivity: Bad request (vocab), missing word or userAnswer.");
             res.status(400).json({ error: "Missing word or userAnswer for vocab activity." });
             return;
          }
          const isSimpleCorrect = payload.userAnswer.trim().toLowerCase() === payload.word.trim().toLowerCase();
          if (isSimpleCorrect) {
             logger.info(`handleActivity (vocab): Correct (simple check)`);
             res.status(200).json({ data: { isCorrect: true, feedback: "Correct!" } });
             return;
          }
           logger.info(`handleActivity (vocab): Incorrect (simple check)`);
           res.status(200).json({ data: { isCorrect: false, feedback: `Incorrect. The word was "${payload.word}".` } });
           return;

        case 'grammar_generate':
           if (!payload.topic || !payload.explanation || !payload.level) {
             logger.error("handleActivity: Bad request (grammar_generate), missing params.");
             res.status(400).json({ error: "Missing topic, explanation, or level for grammar generation." });
             return;
           }
          prompt = `You are a ${targetLangName} teacher. Generate one multiple-choice question in ${uiLangName.toUpperCase()} to test understanding of the ${targetLangName} grammar topic "${payload.topic}" suitable for a ${level} learner. 
            The explanation (in ${uiLangName}) is: "${payload.explanation}".
            Provide 4 distinct options (A, B, C, D) in ${uiLangName}, with only one being correct.
            Respond ONLY with a JSON object following the specified schema.`;
          responseSchema = {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING, description: `The question, in ${uiLangName}.` },
              options: { type: Type.ARRAY, items: { type: Type.STRING }, description: `The 4 multiple choice options, in ${uiLangName}.` },
              correctAnswer: { type: Type.STRING, description: "The letter (A, B, C, or D) corresponding to the correct option." }
            },
            required: ["question", "options", "correctAnswer"]
          };
          break; 

         case 'grammar_grade':
           if (!payload.correctAnswer || payload.userAnswer === undefined || payload.userAnswer === null) {
              logger.error("handleActivity: Bad request (grammar_grade), missing params.");
              res.status(400).json({ error: "Missing correctAnswer or userAnswer for grammar grading." });
              return;
           }
           const isGrammarCorrect = String(payload.userAnswer).trim().toUpperCase() === String(payload.correctAnswer).trim().toUpperCase();
           const feedbackMsg = isGrammarCorrect ? "Correct!" : `Incorrect. The correct answer was ${payload.correctAnswer}.`;
           logger.info(`handleActivity (grammar_grade): Correct: ${isGrammarCorrect}`);
           res.status(200).json({ data: { isCorrect: isGrammarCorrect, feedback: feedbackMsg } });
           return;

        case 'comprehension':
          if (!payload.question || !payload.summary || payload.userAnswer === undefined || payload.userAnswer === null || !payload.level) {
              logger.error("handleActivity: Bad request (comprehension), missing params.");
              res.status(400).json({ error: "Missing question, summary, or userAnswer for comprehension activity." });
              return;
          }
          prompt = `You are a ${targetLangName} teacher grading a ${level} ${uiLangName}-speaking student.
            Based *only* on the following ${targetLangName} summary, evaluate if the user's answer (which is in ${uiLangName}) accurately addresses the question (which is also in ${uiLangName}).
            Summary (in ${targetLangName}): "${payload.summary}"
            Question (in ${uiLangName}): "${payload.question}"
            User Answer (in ${uiLangName}): "${payload.userAnswer}"

            Is the user's answer correct based on the summary? 
            Provide brief feedback in ${uiLangName.toUpperCase()} explaining why or why not (1-2 sentences). 
            Respond ONLY with a JSON object with keys "isCorrect" (boolean) and "feedback" (string, in ${uiLangName}).`;
           break; 

        case 'writing_generate':
           if (!payload.summary || !payload.level || !payload.vocabularyList) {
             logger.error("handleActivity: Bad request (writing_generate), missing params.");
             res.status(400).json({ error: "Missing summary, level, or vocabularyList for writing generation." });
             return;
           }
           const vocabHint = payload.vocabularyList.slice(0, 3).join(', '); // Get 3 words
           
           prompt = `You are a ${targetLangName} teacher. Generate one short writing prompt in ${uiLangName.toUpperCase()} for a ${level} learner.
            The prompt should ask them to write 2-3 sentences in ${targetLangName.toUpperCase()} based on the following news report (which is in ${targetLangName}):
            """
            ${payload.summary}
            """
            The prompt should encourage them to use one or two of these ${targetLangName} words: ${vocabHint}.
            Respond ONLY with a JSON object following the specified schema.`;
           
           responseSchema = {
            type: Type.OBJECT,
            properties: {
              prompt: { type: Type.STRING, description: `The writing prompt for the user, in ${uiLangName}.` },
              vocabularyHint: { type: Type.STRING, description: `A string containing the ${targetLangName} vocabulary words to suggest (e.g., 'word1, word2').` }
            },
            required: ["prompt", "vocabularyHint"]
          };
          break; 

        case 'writing_grade':
          if (!payload.prompt || !payload.summary || payload.userAnswer === undefined || payload.userAnswer === null || !payload.level) {
              logger.error("handleActivity: Bad request (writing_grade), missing params.");
              res.status(400).json({ error: "Missing prompt, summary, userAnswer, or level for writing grading." });
              return;
          }
          
          prompt = `You are a ${targetLangName} teacher grading a ${level} ${uiLangName}-speaking learner.
            Based *only* on the summary and prompt provided, evaluate the user's writing (which should be in ${targetLangName}).
            Summary (in ${targetLangName}): "${payload.summary}"
            Writing Prompt (in ${uiLangName}): "${payload.prompt}"
            User's Answer (in ${targetLangName}): "${payload.userAnswer}"

            Is the user's answer a reasonable and relevant response (in ${targetLangName}) to the prompt?
            Provide 1-2 sentences of constructive feedback in ${uiLangName.toUpperCase()}. Praise what they did well and suggest one simple correction if needed.
            Respond ONLY with a JSON object with keys "isCorrect" (boolean, true if the response is on-topic and makes sense) and "feedback" (string, in ${uiLangName}).`;
          
          break; 

        default:
          logger.error(`handleActivity: Invalid activityType: ${activityType}`);
          res.status(400).json({ error: "Invalid activityType." });
          return;
      }

      logger.info(`Calling Gemini for ${activityType}`);
      const result = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
                ...(responseSchema && { responseMimeType: "application/json", responseSchema: responseSchema }),
                safetySettings: safetySettings,
            },
        });

      // Use .text accessor
      let responseText = result.text;
      if (!responseText) {
        logger.error(`Gemini response empty for ${activityType}`, JSON.stringify(result, null, 2));
        throw new Error(`AI generation failed for ${activityType}.`);
      }

      if (activityType === 'comprehension' || activityType === 'writing_grade') {
          responseText = responseText.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
      }

      try {
        const jsonResponse = JSON.parse(responseText);

        if ((activityType === 'comprehension' || activityType === 'writing_grade') && jsonResponse.feedback && typeof jsonResponse.feedback === 'string') {
            jsonResponse.feedback = jsonResponse.feedback.replace(/`/g, ''); // Remove all backticks
        }

        if (activityType === 'comprehension' && jsonResponse.isCorrect === undefined) {
            jsonResponse.isCorrect = jsonResponse.feedback?.toLowerCase().includes("correct") ?? false;
        }
        
        logger.info(`handleActivity: Success for ${activityType}.`);
        res.status(200).json({ data: jsonResponse });
        return;
      } catch (parseError) {
        logger.error(`Failed to parse Gemini JSON response for ${activityType}:`, parseError, "Raw text:", responseText);
        if (activityType === 'comprehension') {
            const cleanedFeedback = responseText.replace(/`/g, '');
            res.status(200).json({ data: { 
                isCorrect: cleanedFeedback.toLowerCase().includes("correct"),
                feedback: cleanedFeedback 
            }});
            return;
        }
        throw new Error(`AI returned invalid format for ${activityType}.`);
      }

    } catch (e) {
      const message = (e as Error).message;
      const status = message.includes("Unauthenticated") ? 401 : 500;
      logger.error("Function Error (handleActivity):", e);
      res.status(status).json({ error: `Activity processing failed: ${message}` });
    }
  }
);

// --- NEW: textToSpeech Function ---
export const textToSpeech = onRequest(
  { secrets: ["TTS_SERVICE_ACCOUNT_KEY"], cors: true, memory: '256MiB', region: 'us-central1' },
  async (req, res) => {
    // Set CORS headers for all responses
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

     if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }

    try {
      await getAuthenticatedUid(req); 
      logger.info(`textToSpeech: Authenticated user.`);

      const { text, langCode = "en" } = req.body.data;
      if (!text) {
        logger.error("textToSpeech: Bad request, missing 'text'.");
        res.status(400).json({ error: "Missing 'text' in request body." });
        return;
      }
      if (typeof text !== 'string' || text.length > 1500) { 
         logger.error(`textToSpeech: Bad request, text not string or too long (${text.length} chars).`);
         res.status(400).json({ error: "'text' must be a string under 1500 characters." });
         return;
      }

      let clientOptions = {};
      if (process.env.TTS_SERVICE_ACCOUNT_KEY) {
          try {
              const serviceAccount = JSON.parse(process.env.TTS_SERVICE_ACCOUNT_KEY);
              clientOptions = { credentials: serviceAccount, projectId: serviceAccount.project_id };
          } catch (e) {
              logger.error("Failed to parse TTS_SERVICE_ACCOUNT_KEY JSON:", e);
              res.status(500).json({ error: "Server configuration error (TTS Credentials)." });
              return;
          }
      } else {
           logger.error("TTS_SERVICE_ACCOUNT_KEY secret is not set.");
           res.status(500).json({ error: "Server configuration error (TTS Secret missing)." });
           return;
      }

      const client = new TextToSpeech.TextToSpeechClient(clientOptions);
      
      const ttsLanguageCode = getGoogleTTSLangCode(langCode);
      logger.info(`TTS Request: Text: "${text.substring(0, 20)}...", AppLang: "${langCode}", TTSLang: "${ttsLanguageCode}"`);

      const request = {
        input: { text: text },
        voice: { 
          languageCode: ttsLanguageCode, 
          ssmlGender: 'NEUTRAL' as const 
        },
        audioConfig: { audioEncoding: 'MP3' as const },
      };

      const [response] = await client.synthesizeSpeech(request);

      if (!response.audioContent) {
          logger.error("TTS API returned no audio content.");
          res.status(500).json({ error: "Failed to generate audio." });
          return;
      }

      res.status(200).json({
        data: { 
          audioContent: response.audioContent.toString('base64'),
        }
      });
       return; 

    } catch (e) {
      const message = (e as Error).message;
      const status = message.includes("Unauthenticated") || message.includes("Invalid") ? 401 : 500;
      logger.error("Function Error (textToSpeech):", e);
      res.status(status).json({ error: `Audio generation failed: ${message}` });
    }
  }
);

// --- NEW: enforceLessonLimit Function ---
const LESSON_LIMIT = 50;

export const enforceLessonLimit = onDocumentCreated({document: "users/{userId}/lessons/{lessonId}", region: 'us-central1'}, async (event) => {
    const { userId } = event.params;
    if (!userId) {
        logger.error("No userId found in event params.");
        return;
    }

    const lessonsRef = admin.firestore()
                             .collection(`users/${userId}/lessons`);

    try {
        const snapshot = await lessonsRef.orderBy("createdAt", "asc").get();

        const lessonCount = snapshot.size;
        const lessonsToDelete = lessonCount - LESSON_LIMIT;

        if (lessonsToDelete > 0) {
            logger.info(`User ${userId} has ${lessonCount} lessons. Deleting ${lessonsToDelete} oldest lessons.`);
            
            const batch = admin.firestore().batch();
            snapshot.docs.slice(0, lessonsToDelete).forEach(doc => {
                batch.delete(doc.ref);
            });

            await batch.commit();
            logger.info(`Successfully deleted ${lessonsToDelete} old lessons for user ${userId}.`);
        } else {
            logger.info(`User ${userId} has ${lessonCount} lessons. No cleanup needed.`);
        }
    } catch (error) {
        logger.error(`Error enforcing lesson limit for user ${userId}:`, error);
    }
});

/**
 * Creates a Stripe Customer Portal link for the user.
 */
export const createPortalLink = onRequest(
  {cors: true, timeoutSeconds: 60, region: 'us-central1'}, 
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') { 
      res.status(204).send(''); 
      return; 
    }
    
    try {
      const userId = await getAuthenticatedUid(req);
      const { returnUrl } = req.body.data;
      if (!returnUrl) {
        logger.error("createPortalLink: Bad request, missing 'returnUrl'.");
        res.status(400).json({ error: "Missing 'returnUrl' parameter." });
        return;
      }

      const db = admin.firestore();
      
      const portalLinkRef = await db
        .collection('customers') // Per your firestore.rules
        .doc(userId)
        .collection('portal_links')
        .add({
          return_url: returnUrl, 
          created: admin.firestore.FieldValue.serverTimestamp(),
        });
      
      logger.info(`Created portal_links doc ${portalLinkRef.id} for user ${userId}`);

      const url = await new Promise<string>((resolve, reject) => {
        const unsubscribe = portalLinkRef.onSnapshot(
          (snapshot) => {
            const data = snapshot.data();
            if (data?.url) { 
              unsubscribe();
              resolve(data.url);
            } else if (data?.error) { 
              unsubscribe();
              reject(new Error(data.error.message || "Stripe extension error."));
            }
          },
          (err) => { 
            unsubscribe();
            reject(err);
          }
        );

        setTimeout(() => {
          unsubscribe();
          reject(new Error("Timeout: Stripe extension did not respond in 30 seconds."));
        }, 30000); 
      });

      res.status(200).json({ data: { url: url } });

    } catch (error) {
      const message = (error as Error).message;
      const status = message.includes("Unauthenticated") || message.includes("Invalid") ? 401 : 500;
      logger.error("Function Error (createPortalLink):", error);
      res.status(status).json({error: `Failed to create portal link: ${message}`});
    }
  }
);

// --- NEW: chatWithAssistant Function (Using stateless generateContent) ---
export const chatWithAssistant = onRequest(
  { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 60, cors: true, region: 'us-central1' },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') { 
      res.status(204).send(''); 
      return; 
    }

    try {
      await getAuthenticatedUid(req); // Authenticate
      const { lessonData, chatHistory, uiLanguage, targetLanguage } = req.body.data;

      if (!lessonData || !chatHistory || !uiLanguage || !targetLanguage) {
        logger.error("chatWithAssistant: Bad request, missing params.");
        res.status(400).json({ error: "Missing lessonData, chatHistory, or language parameters." });
        return;
      }

      const geminiApiKey = process.env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        logger.error("Secret Configuration Error: GEMINI_API_KEY missing.");
        res.status(500).json({ error: "Server configuration error." });
        return;
      }
      const ai = new GoogleGenAI({ apiKey: geminiApiKey });

      const uiLangName = getLanguageName(uiLanguage);
      const targetLangName = getLanguageName(targetLanguage);
      const lesson = lessonData as any; 

      const vocabList = lesson.vocabularyList.map((v: any) =>
        `- ${v.word} (${targetLangName}): ${v.definition} (${uiLangName}). Example: "${v.articleExample}"`
      ).join('\n');
      
      const comprehensionQuestions = lesson.comprehensionQuestions.join('\n- ');

      const systemPrompt = `
You are "Max," a friendly, patient, and expert language tutor.
You are helping a student who is learning ${targetLangName} and speaks ${uiLangName}.
Your entire knowledge base for this conversation is STRICTLY limited to the following lesson data:

--- START LESSON DATA ---
Article Title (${targetLangName}): ${lesson.articleTitle}
Summary (${targetLangName}): ${lesson.summary}

Vocabulary List:
${vocabList}

Grammar Focus (${uiLangName} explanation):
- Topic: ${lesson.grammarFocus.topic}
- Explanation: ${lesson.grammarFocus.explanation}

Comprehension Questions (${uiLangName}):
- ${comprehensionQuestions}
--- END LESSON DATA ---

YOUR ROLE AND RULES:
1.  You are conversational and helpful in *both* ${uiLangName} and ${targetLangName}. You can switch languages if the user does, but always be clear.
2.  Your primary goal is to help the user understand the lesson. You can answer questions about the summary, vocabulary, or grammar.
3.  You can provide new example sentences (in ${targetLangName}) using the vocabulary.
4.  You can explain the grammar concepts more deeply, but do not introduce new topics not mentioned in the lesson.
5.  You can help the user practice by asking them questions related to the lesson.
6.  **CRITICAL RULE:** If the user asks a question *outside* the scope of this lesson (e.g., "What is the capital of France?", "Tell me a joke," "Who are you?", "What's the weather?"), you MUST politely decline and guide them back to the lesson. Respond in ${uiLanguage} with something like: "I'm Max, your assistant for this lesson! I can only help with questions about the article, vocabulary, or grammar we just covered. Do you have any questions about those?"
7.  Keep your answers concise and easy to understand for the student's level.
`;

      const fullContents = chatHistory.map((msg: any) => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
      }));

      if (fullContents.length === 0 || fullContents[fullContents.length - 1].role !== 'user') {
        logger.error("Chat history is empty or does not end with a 'user' message.", fullContents);
        res.status(400).json({ error: "Invalid chat history: Must end with a user message." });
        return;
      }

      const safetySettings = [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ];

      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash", 
        contents: fullContents, 
        config: {
          safetySettings: safetySettings,
          systemInstruction: { parts: [{ text: systemPrompt }] },
        }
      });

      // Use .text accessor
      const responseText = result.text;
      if (!responseText) {
        logger.error("Gemini response (chat) was empty.", JSON.stringify(result, null, 2));
        throw new Error("The assistant did not provide a response.");
      }

      res.status(200).json({ data: { text: responseText } });

    } catch (e) {
      const message = (e as Error).message;
      const status = message.includes("Unauthenticated") ? 401 : 500;
      logger.error("Function Error (chatWithAssistant):", e);
      res.status(status).json({ error: `Chat failed: ${message}` });
    }
  }
);

// --- NEW: getEphemeralToken Function (REWRITE) ---
export const getEphemeralToken = onRequest(
  { secrets: ["GEMINI_API_KEY"], cors: true, region: 'us-central1' },
  async (req, res) => {
    // Set CORS headers for all responses
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    const _CALL_ID = `getEphemeralToken_${Date.now()}`;
    logger.info(`[${_CALL_ID}] 1/15: Function triggered.`);
    
    if (req.method === 'OPTIONS') {
      logger.info(`[${_CALL_ID}] 1.1/15: Responding to OPTIONS request.`);
      res.status(204).send(''); 
      return; 
    }

    try {
      logger.info(`[${_CALL_ID}] 2/15: Attempting to get authenticated UID.`);
      await getAuthenticatedUid(req);
      logger.info(`[${_CALL_ID}] 3/15: UID authenticated.`);

      // 2. Get lesson data from the request
      logger.info(`[${_CALL_ID}] 4/15: Parsing request body data...`);
      const { lessonData, uiLanguage, targetLanguage } = req.body.data;
      if (!lessonData || !uiLanguage || !targetLanguage) {
        logger.error(`[${_CALL_ID}] FAILED (4/15): Missing lessonData, uiLanguage, or targetLanguage.`);
        throw new Error("Missing data for token generation.");
      }
      logger.info(`[${_CALL_ID}] 5/15: Request body data parsed successfully.`);

      // 3. Get the Gemini API Key
      logger.info(`[${_CALL_ID}] 6/15: Retrieving GEMINI_API_KEY secret.`);
      const geminiApiKey = process.env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        logger.error(`[${_CALL_ID}] FAILED (6/15): Secret Configuration Error: GEMINI_API_KEY missing.`);
        throw new Error("Server configuration error.");
      }
      logger.info(`[${_CALL_ID}] 7/15: GEMINI_API_KEY retrieved.`);

      // 4. Initialize the GenAI client, forcing v1alpha for auth tokens
      logger.info(`[${_CALL_ID}] 8/15: Initializing GoogleGenAI client with v1alpha.`);
      const ai = new GoogleGenAI({
        apiKey: geminiApiKey,
        httpOptions: { apiVersion: 'v1alpha' } // Force v1alpha
      });

      // 5. Define the model
      const model = "models/gemini-2.5-flash-native-audio-preview-09-2025"; 
      logger.info(`[${_CALL_ID}] 9/15: Model set to: ${model}`);

      // 6. Build the System Prompt
      logger.info(`[${_CALL_ID}] 10/15: Building system prompt...`);
      const uiLangName = getLanguageName(uiLanguage);
      const targetLangName = getLanguageName(targetLanguage);
      const lesson = lessonData as any;
      const vocabList = lesson.vocabularyList.map((v: any) =>
        `- ${v.word} (${targetLangName}): ${v.definition} (${uiLangName}). Example: "${v.articleExample}"`
      ).join('\n');
      const comprehensionQuestions = lesson.comprehensionQuestions.join('\n- ');
      
      const systemPrompt = `
You are "Max," a friendly, patient, and expert language tutor.
You are helping a student who is learning ${targetLangName} and speaks ${uiLangName}.
Your entire knowledge base for this conversation is STRICTLY limited to the following lesson data:
--- START LESSON DATA ---
Article Title (${targetLangName}): ${lesson.articleTitle}
Summary (${targetLangName}): ${lesson.summary}
Vocabulary List: ${vocabList}
Grammar Focus (${uiLangName} explanation):
- Topic: ${lesson.grammarFocus.topic}
- Explanation: ${lesson.grammarFocus.explanation}
Comprehension Questions (${uiLangName}):
- ${comprehensionQuestions}
--- END LESSON DATA ---
YOUR ROLE AND RULES:
1.  You are conversational and helpful in *both* ${uiLangName} and ${targetLangName}.
2.  Your primary goal is to help the user understand the lesson.
3.  **CRITICAL RULE:** If the user asks a question *outside* the scope of this lesson, you MUST politely decline and guide them back to the lesson.
4.  Keep your answers concise and easy to understand.
5.  You MUST respond with both TEXT AND AUDIO.`;
      logger.info(`[${_CALL_ID}] 10/15: System prompt built successfully.`);


      // 7. Define the *exact* connection config
      logger.info(`[${_CALL_ID}] 11/15: Defining connection config constraints...`);

      // ***** THIS IS THE FIX (PART 1) *****
      // The connectionConfig object should NOT contain the model
      const connectionConfig = {
        // model: model, // <-- DELETE THIS LINE
        responseModalities: [Modality.AUDIO],
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
        speechConfig: {
          voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Zephyr'}},
        },
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contextWindowCompression: {
             triggerTokens: '25600',
             slidingWindow: { targetTokens: '12800' },
        },
        tools: [],
      };
      // **********************************
      logger.info(`[${_CALL_ID}] 11/15: Connection config defined: ${JSON.stringify(connectionConfig)}`);

      // 8. Create the ephemeral token config
      // ***** THIS IS THE FIX (PART 2) *****
      // The liveConnectConstraints object needs 'model' and 'config' as
      // separate properties, not merged.
      const tokenConfig = {
        config: {
          uses: 1, 
          liveConnectConstraints: {
            model: model, // <-- The model string goes here
            config: connectionConfig // <-- The config object goes here
          }
        }
      };
      // **********************************
      logger.info(`[${_CALL_ID}] 12/15: Token config object created. Requesting token from Google...`);
      
      // 9. Create the token
      const token = await ai.authTokens.create(tokenConfig);
      logger.info(`[${_CALL_ID}] 13/15: Token received from Google.`);

      if (!token || !token.name) {
        logger.error(`[${_CALL_ID}] FAILED (13/15): Google Token API did not return a token name.`);
        throw new Error("Google API failed to create a token.");
      }

      // 10. Send the token *value* (token.name) to the client
      logger.info(`[${_CALL_ID}] 14/15: Success. Sending token to client.`);
      res.status(200).json({ data: { token: token.name } });
      logger.info(`[${_CALL_ID}] 15/15: Function complete.`);

    } catch (e) {
      const message = (e as Error).message;
      logger.error(`[${_CALL_ID}] FAILED: Function Error:`, e);
      res.status(500).json({ error: `Token generation failed: ${message}` });
    }
  }
);