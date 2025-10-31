    import * as functions from "firebase-functions";
    import {onRequest} from "firebase-functions/v2/https";
    import * as admin from "firebase-admin";
    import "firebase-admin/functions";
    import fetch, { RequestInit } from "node-fetch"; // For fetchNews
    import { onDocumentCreated } from "firebase-functions/v2/firestore";
    import { GoogleGenAI, HarmCategory, HarmBlockThreshold, Type, Modality } from "@google/genai";
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
        const subscriptionsRef = db.collection(`users/${userId}/subscriptions`);
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
              image: item.image || undefined
            })).filter((item: NewsResult) => item.title && item.link)); // Type check here

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
    // (This replaces your existing createLesson function)
    // ----------------------------------------------------------------------
    export const createLesson = onRequest(
      {secrets: ["GEMINI_API_KEY"], timeoutSeconds: 120, cors: true},
      async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
        try {
            const userId = await getAuthenticatedUid(req);
            const { canCreate, isSubscribed, message } = await checkUsageAndSubscription(userId);
            if (!canCreate) {
              // Send 402 Payment Required status
              res.status(402).json({ error: message });
              return;
            }
            const { articleUrl, level, title, snippet, uiLanguage = "en", targetLanguage = "en" } = req.body;
            if (!articleUrl || !title) {
              res.status(400).json({error: "Missing article URL and title."});
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

            // --- Language Names for Prompts ---
            const uiLangName = getLanguageName(uiLanguage);
            const targetLangName = getLanguageName(targetLanguage);

            // ---------- ATTEMPT 1: Get Article Summary via URL Context ----------
            logger.info(`Attempt 1: Fetching summary via urlContext for ${articleUrl}`);
            const urlSummaryPrompt = `Act as a news reporter. Report the key facts, events, and information from the content at this URL: ${articleUrl} IN ${targetLangName.toUpperCase()}. 
                Your report should be between 5 and 10 sentences long. 
                Do not use words like 'article', 'summary', or 'this text' in ${targetLangName}. Report the information directly.
                IMPORTANT: After your news report, on a new line, in ENGLISH, explicitly state "PAYWALL_DETECTED" if the full content seems to be behind a paywall or requires a subscription/login based on the fetched content. If no paywall is obvious, state "PAYWALL_NOT_DETECTED".`;

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
                logger.info(`Attempt 2: Generating summary via grounding for ${articleUrl}`);

                // FIX: Dynamic grounding prompt in target language
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
                
                // --- ADDITION: Enforce Markdown formatting for the explanation ---
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

            if (!isSubscribed) {
              await incrementLessonUsage(userId);
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

    // --- NEW: handleActivity Function ---
    export const handleActivity = onRequest(
      { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 120, cors: true },
      async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

        try {
          // FIX: Get all language/level parameters
          const { activityType, payload } = req.body;
          const { 
            level = "Intermediate",
            uiLanguage = "en",
            targetLanguage = "en" 
          } = payload; // Extract from payload

          const uiLangName = getLanguageName(uiLanguage);
          const targetLangName = getLanguageName(targetLanguage);

          if (!activityType || !payload) {
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
          let responseSchema: any = null; // Use schema for grammar generation

          switch (activityType) {
            // --- Vocabulary Grading ---
            case 'vocab':
              if (!payload.word || !payload.userAnswer) {
                 res.status(400).json({ error: "Missing word or userAnswer for vocab activity." });
                 return;
              }
              // Simple check first, fallback to AI for slight variations? (Optional enhancement)
              const isSimpleCorrect = payload.userAnswer.trim().toLowerCase() === payload.word.trim().toLowerCase();
              if (isSimpleCorrect) {
                 res.status(200).json({ isCorrect: true, feedback: "Correct!" });
                 return;
              }
              // Optional: AI check for typos/close answers
              prompt = `The correct vocabulary word is "${payload.word}". The user guessed "${payload.userAnswer}". Is the user's guess essentially correct, possibly with a minor typo? Answer only "yes" or "no".`;
              // For simplicity now, we'll just use the simple check. Expand later if needed.
               res.status(200).json({ isCorrect: false, feedback: `Incorrect. The word was "${payload.word}".` });
               return;

            // --- Grammar Quiz Generation ---
            case 'grammar_generate':
               if (!payload.topic || !payload.explanation || !payload.level) {
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
              break; // Proceed to Gemini call

            // --- Grammar Grading (Simple Check) ---
             case 'grammar_grade':
               if (!payload.correctAnswer || payload.userAnswer === undefined || payload.userAnswer === null) {
                  res.status(400).json({ error: "Missing correctAnswer or userAnswer for grammar grading." });
                  return;
               }
               const isGrammarCorrect = String(payload.userAnswer).trim().toUpperCase() === String(payload.correctAnswer).trim().toUpperCase();
               prompt = `You are a helpful teacher grading a quiz. The user's answer was ${isGrammarCorrect ? "CORRECT" : "INCORRECT"}. 
                 The correct answer was "${payload.correctAnswer}".
                 Write a very brief (1-2 sentence) feedback message in ${uiLangName.toUpperCase()}.
                 If correct, just say "Correct!". 
                 If incorrect, say "Incorrect. The correct answer was ${payload.correctAnswer}."
                 Respond ONLY with a JSON object: {"isCorrect": ${isGrammarCorrect}, "feedback": "Your feedback message in ${uiLangName}"}`;
               return;

            // --- Comprehension Grading ---
            case 'comprehension':
              if (!payload.question || !payload.summary || payload.userAnswer === undefined || payload.userAnswer === null || !payload.level) {
                  res.status(400).json({ error: "Missing question, summary, or userAnswer for comprehension activity." });
                  return;
              }
              // FIX: Dynamic prompt
              prompt = `You are a ${targetLangName} teacher grading a ${level} ${uiLangName}-speaking student.
                Based *only* on the following ${targetLangName} summary, evaluate if the user's answer (which is in ${uiLangName}) accurately addresses the question (which is also in ${uiLangName}).
                Summary (in ${targetLangName}): "${payload.summary}"
                Question (in ${uiLangName}): "${payload.question}"
                User Answer (in ${uiLangName}): "${payload.userAnswer}"

                Is the user's answer correct based on the summary? 
                Provide brief feedback in ${uiLangName.toUpperCase()} explaining why or why not (1-2 sentences). 
                Respond ONLY with a JSON object with keys "isCorrect" (boolean) and "feedback" (string, in ${uiLangName}).`;
               break; // Proceed to Gemini call

            // --- NEW: Writing Prompt Generation ---
            case 'writing_generate':
               if (!payload.summary || !payload.level || !payload.vocabularyList) {
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
              break; // Proceed to Gemini call

            // --- NEW: Writing Grading ---
            case 'writing_grade':
              if (!payload.prompt || !payload.summary || payload.userAnswer === undefined || payload.userAnswer === null || !payload.level) {
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
              
              // No responseSchema needed, will parse JSON like comprehension
              break; // Proceed to Gemini call

            default:
              res.status(400).json({ error: "Invalid activityType." });
              return;
          }

          // --- Call Gemini for Grammar Gen or Comprehension Grade ---
          logger.info(`Calling Gemini for ${activityType}`);
          const result = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                config: {
                    // Use responseSchema only for grammar_generate
                    ...(responseSchema && { responseMimeType: "application/json", responseSchema: responseSchema }),
                    safetySettings: safetySettings,
                },
            });


          let responseText = result.text;
          if (!responseText) {
            logger.error(`Gemini response empty for ${activityType}`, JSON.stringify(result, null, 2));
            throw new Error(`AI generation failed for ${activityType}.`);
          }

          if (activityType === 'comprehension' || activityType === 'writing_grade') {
              // Remove potential markdown fences (```json ... ```) and trim whitespace
              responseText = responseText.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
          }

          try {
            const jsonResponse = JSON.parse(responseText);

            if ((activityType === 'comprehension' || activityType === 'writing_grade') && jsonResponse.feedback && typeof jsonResponse.feedback === 'string') {
                jsonResponse.feedback = jsonResponse.feedback.replace(/`/g, ''); // Remove all backticks
            }

            // For comprehension, add simple isCorrect check if missing (basic fallback)
            if (activityType === 'comprehension' && jsonResponse.isCorrect === undefined) {
                jsonResponse.isCorrect = jsonResponse.feedback?.toLowerCase().includes("correct") ?? false;
            }
            res.status(200).json(jsonResponse);
            return;
          } catch (parseError) {
            logger.error(`Failed to parse Gemini JSON response for ${activityType}:`, parseError, "Raw text:", responseText);
            // Fallback for comprehension if JSON fails but text might be useful
            if (activityType === 'comprehension') {
                // --- ALSO CLEAN FEEDBACK HERE ---
                const cleanedFeedback = responseText.replace(/`/g, '');
                // --- END CLEAN ---
                res.status(200).json({
                    isCorrect: cleanedFeedback.toLowerCase().includes("correct"),
                    feedback: cleanedFeedback // Send cleaned raw text as feedback
                });
                return; // <-- Ensure return here
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
      // IMPORTANT: Add your TTS service account key as a secret!
      { secrets: ["TTS_SERVICE_ACCOUNT_KEY"], cors: true, memory: '256MiB' },
      async (req, res) => {
        // Enable CORS for OPTIONS request
        res.set('Access-Control-Allow-Origin', '*'); // Or restrict to your domain in production
         if (req.method === 'OPTIONS') {
            res.set('Access-Control-Allow-Methods', 'POST');
            res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            res.set('Access-Control-Max-Age', '3600');
            res.status(204).send('');
            return;
        }

        try {
          // Basic check - you might want auth check here too if needed
          await getAuthenticatedUid(req); // Optional: uncomment if only logged-in users can use TTS

          const { text, langCode = "en" } = req.body;
          if (!text) {
            res.status(400).json({ error: "Missing 'text' in request body." });
            return;
          }
          if (typeof text !== 'string' || text.length > 1500) { // Limit input length
             res.status(400).json({ error: "'text' must be a string under 1500 characters." });
             return;
          }


          // --- Initialize TTS Client ---
          let clientOptions = {};
          // Check if the secret exists and parse it (assuming it's JSON)
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
          // --- End TTS Client Init ---

          const ttsLanguageCode = getGoogleTTSLangCode(langCode);
          logger.info(`TTS Request: Text: "${text.substring(0, 20)}...", AppLang: "${langCode}", TTSLang: "${ttsLanguageCode}"`);

          const request = {
            input: { text: text },
            voice: { 
              languageCode: ttsLanguageCode, // <-- PHASE 3 FIX
              ssmlGender: 'NEUTRAL' as const 
            },
            audioConfig: { audioEncoding: 'MP3' as const },
          };

          // Performs the text-to-speech request
          const [response] = await client.synthesizeSpeech(request);

          if (!response.audioContent) {
              logger.error("TTS API returned no audio content.");
              res.status(500).json({ error: "Failed to generate audio." });
              return;
          }

          // Send the audio content back as Base64
          res.status(200).json({
            audioContent: response.audioContent.toString('base64'),
          });
           return; // Explicit return

        } catch (e) {
          const message = (e as Error).message;
          logger.error("Function Error (textToSpeech):", e);
          res.status(500).json({ error: `Audio generation failed: ${message}` });
          // No return needed here
        }
      }
    );

    // --- NEW: enforceLessonLimit Function ---
    // This function triggers when a new lesson is created.
    // It checks if the user has more than 50 lessons and deletes the oldest ones.
    const LESSON_LIMIT = 50;

    export const enforceLessonLimit = onDocumentCreated("users/{userId}/lessons/{lessonId}", async (event) => {
        const { userId } = event.params;
        if (!userId) {
            logger.error("No userId found in event params.");
            return;
        }

        const lessonsRef = admin.firestore()
                                 .collection(`users/${userId}/lessons`);

        try {
            // Query for all lessons, ordered by creation time (oldest first)
            const snapshot = await lessonsRef.orderBy("createdAt", "asc").get();

            const lessonCount = snapshot.size;
            const lessonsToDelete = lessonCount - LESSON_LIMIT;

            if (lessonsToDelete > 0) {
                logger.info(`User ${userId} has ${lessonCount} lessons. Deleting ${lessonsToDelete} oldest lessons.`);
                
                // Get the oldest documents to delete
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
     * This version uses a document-write trigger instead of a callable function.
     */
    export const createPortalLink = onRequest(
      {cors: true, timeoutSeconds: 60}, // Added timeout for listener
      async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
        
        try {
          const userId = await getAuthenticatedUid(req);
          const { returnUrl } = req.body;
          if (!returnUrl) {
            res.status(400).json({ error: "Missing 'returnUrl' parameter." });
            return;
          }

          const db = admin.firestore();
          
          // 1. Create the portal link document
          // The Stripe extension listens for this document creation
          const portalLinkRef = await db
            .collection('customers')
            .doc(userId)
            .collection('portal_links')
            .add({
              return_url: returnUrl, // Use snake_case as required by the extension
              created: admin.firestore.FieldValue.serverTimestamp(),
            });
          
          logger.info(`Created portal_links doc ${portalLinkRef.id} for user ${userId}`);

          // 2. Listen to the document for the URL
          // We use a promise to handle the asynchronous listener
          const url = await new Promise<string>((resolve, reject) => {
            // Set up the listener
            const unsubscribe = portalLinkRef.onSnapshot(
              (snapshot) => {
                const data = snapshot.data();
                if (data?.url) { // Success: The extension wrote the URL
                  unsubscribe();
                  resolve(data.url);
                } else if (data?.error) { // Error: The extension wrote an error
                  unsubscribe();
                  reject(new Error(data.error.message || "Stripe extension error."));
                }
                // If neither url nor error exists yet, the listener just waits
              },
              (err) => { // Handle listener error
                unsubscribe();
                reject(err);
              }
            );

            // 3. Add a timeout for safety
            setTimeout(() => {
              unsubscribe();
              reject(new Error("Timeout: Stripe extension did not respond in 30 seconds."));
            }, 30000); // 30-second timeout
          });

          // 4. Send the URL back to the client
          res.status(200).json({ url: url });

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
      { secrets: ["GEMINI_API_KEY"], timeoutSeconds: 60, cors: true },
      async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

        try {
          // FIX 1: Add underscore to 'userId' to fix the TS6133 error
          const { lessonData, chatHistory, uiLanguage, targetLanguage } = req.body;

          if (!lessonData || !chatHistory || !uiLanguage || !targetLanguage) {
            res.status(400).json({ error: "Missing lessonData, chatHistory, or language parameters." });
            return;
          }

          // --- 1. Get API Key ---
          const geminiApiKey = process.env.GEMINI_API_KEY;
          if (!geminiApiKey) {
            logger.error("Secret Configuration Error: GEMINI_API_KEY missing.");
            res.status(500).json({ error: "Server configuration error." });
            return;
          }
          const ai = new GoogleGenAI({ apiKey: geminiApiKey });

          // --- 2. Define Persona and Rules (System Prompt) ---
          const uiLangName = getLanguageName(uiLanguage);
          const targetLangName = getLanguageName(targetLanguage);
          const lesson = lessonData as any; // Cast to access properties

          const vocabList = lesson.vocabularyList.map((v: any) =>
            `- ${v.word} (${targetLangName}): ${v.definition} (${uiLangName}). Example: "${v.articleExample}"`
          ).join('\n');
          
          const comprehensionQuestions = lesson.comprehensionQuestions.join('\n- ');

          // The robust system prompt
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

          // --- 3. Format Contents Array (Your "cURL ideology") ---
          const fullContents = chatHistory.map((msg: any) => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.text }]
          }));

          if (fullContents.length === 0 || fullContents[fullContents.length - 1].role !== 'user') {
            logger.error("Chat history is empty or does not end with a 'user' message.", fullContents);
            res.status(400).json({ error: "Invalid chat history: Must end with a user message." });
            return;
          }

          // --- 4. Call generateContent (Stateless) ---
          const safetySettings = [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          ];

          // FIX 2: Use ai.models.generateContent directly
          const result = await ai.models.generateContent({
            model: "gemini-2.5-flash", 
            contents: fullContents, // Pass the full chat history
            config: {
              safetySettings: safetySettings,
              // Pass the system prompt via the 'config' object
              systemInstruction: { parts: [{ text: systemPrompt }] },
            }
          });
          // --- End of Fix 2 ---

          const responseText = result.text;
          if (!responseText) {
            logger.error("Gemini response (chat) was empty.", JSON.stringify(result, null, 2));
            throw new Error("The assistant did not provide a response.");
          }

          res.status(200).json({ text: responseText });

        } catch (e) {
          const message = (e as Error).message;
          const status = message.includes("Unauthenticated") ? 401 : 500;
          logger.error("Function Error (chatWithAssistant):", e);
          res.status(status).json({ error: `Chat failed: ${message}` });
        }
      }
    );

   // --- NEW: getEphemeralToken Function (Corrected Version) ---
    // This function creates a short-lived token for the client to connect to Google's AI Studio API
    export const getEphemeralToken = onRequest(
      { secrets: ["GEMINI_API_KEY"], cors: true }, // <-- Make sure GEMINI_API_KEY is in secrets
      async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

        try {
          // 1. Ensure the user is authenticated with *your* app
          await getAuthenticatedUid(req);

          // 2. Get the Gemini API Key
          const geminiApiKey = process.env.GEMINI_API_KEY;
          if (!geminiApiKey) {
            logger.error("Secret Configuration Error: GEMINI_API_KEY missing.");
            throw new Error("Server configuration error.");
          }

          // 3. Initialize the GenAI client, forcing v1alpha for auth tokens
          // This is the key insight from the documentation you provided
          const ai = new GoogleGenAI({
            apiKey: geminiApiKey,
            httpOptions: { apiVersion: 'v1alpha' } // Force v1alpha
          });

          // 4. Define the model we are authorizing (from your docs)
          const model = "gemini-live-2.5-flash"; 

          // 5. Create the ephemeral token
          logger.info(`Requesting ephemeral token for model: ${model}`);
          const tokenConfig = {
            config: {
              uses: 1, // The token can only be used to start a single session
              liveConnectConstraints: {
                model: model,
                config: {
                  // Allow both text and audio responses
                  responseModalities: [Modality.TEXT, Modality.AUDIO] 
                }
              },
            }
          };
          logger.info("DEBUG: Token config being sent:", JSON.stringify(tokenConfig));
          // --- END ADD ---

          const token = await ai.authTokens.create(tokenConfig); // <-- Use the config var

          if (!token || !token.name) {
            logger.error("Google Token API did not return a token name.");
            throw new Error("Google API failed to create a token.");
          }

          // 6. Send the token *value* (token.name) to the client
          // The client will use this value as its API key
          res.status(200).json({ token: token.name });

        } catch (e) {
          const message = (e as Error).message;
          logger.error("Function Error (getEphemeralToken):", e);
          res.status(500).json({ error: `Token generation failed: ${message}` });
        }
      }
    );