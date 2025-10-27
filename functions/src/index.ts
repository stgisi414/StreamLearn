import * as functions from "firebase-functions";
import {onRequest} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import fetch, {RequestInit} from "node-fetch";
import * as cheerio from "cheerio";
import {GoogleGenAI} from "@google/genai";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const HttpsProxyAgent = require("https-proxy-agent");
import * as logger from "firebase-functions/logger";

// --- Firebase Admin Init ---
if (!admin.apps.length) {
    // FIX: Suppress redundant initialization errors in emulator mode
    admin.initializeApp();
}
const auth = admin.auth();


// ----------------------------------------------------------------------
// CONFIGURATION & HELPERS
// ----------------------------------------------------------------------

const BRIGHTDATA_SECRETS = [
  "BRIGHTDATA_CUSTOMER_ID",
  "BRIGHTDATA_ZONE_NAME",
  "BRIGHTDATA_API_TOKEN",
];
const ALL_SECRETS = [...BRIGHTDATA_SECRETS, "GEMINI_API_KEY"];
const BRIGHTDATA_ENDPOINT = "https://zproxy.lum-superproxy.io:22225/serp";

// --- REMOVED handleCors function ---

/**
 * Extracts and verifies the Firebase ID token from the Authorization header.
 * @param {functions.https.Request} req The incoming HTTPS request object.
 * @return {Promise<string>} The UID of the authenticated user.
 */
async function getAuthenticatedUid(req: functions.https.Request): Promise<string> {
    const authorization = req.headers.authorization;
    const idToken = authorization?.split('Bearer ')[1];

    if (!idToken) {
        throw new Error("Missing or malformed Authorization header. Must be 'Bearer <token>'.");
    }
    
    try {
        const decodedToken = await auth.verifyIdToken(idToken);
        return decodedToken.uid;
    } catch (e) {
        logger.error("Token Verification Failed:", e);
        throw new Error("Invalid or expired authentication token.");
    }
}

/**
 * Attempts to parse HTML content using Cheerio to find the main article body.
 */
function extractArticleText(html: string): string {
  const $ = cheerio.load(html);
  const articleElements = "article, .article-body, .post-content, main";

  let articleText = "";
  $(articleElements).each((_i, elem) => {
    const text = $(elem).text().trim();
    if (text.length > articleText.length) {
      articleText = text;
    }
  });

  if (articleText.length < 100) {
    articleText = $("p").map((_i, el) => $(el).text()).get().join("\n").trim();
  }

  return articleText.replace(/(\n\s*){3,}/g, "\n\n").substring(0, 8000);
}


// ----------------------------------------------------------------------
// CLOUD FUNCTION 1: fetchNews (HTTP FUNCTION)
// ----------------------------------------------------------------------

export const fetchNews = onRequest(
  {secrets: BRIGHTDATA_SECRETS, cors: true},
  async (req, res) => {
      // CORS now handled by `cors: true` option (for production)
      // and Vite proxy (for local development)
      res.setHeader('Content-Type', 'application/json');

      if (req.method === 'OPTIONS') {
          // Preflight should pass due to cors: true, but respond just in case
          res.status(204).send('');
          return;
      }
      
      try {
        // 1. AUTHENTICATION CHECK
        await getAuthenticatedUid(req);

        // 2. DATA EXTRACTION
        const data = req.body;
        const query = data?.query;
        const languageCode = data?.languageCode;

        if (!query) {
            res.status(400).send({error: "The 'query' parameter is required."});
            return;
        }

        const customerId = process.env.BRIGHTDATA_CUSTOMER_ID;
        const zoneName = process.env.BRIGHTDATA_ZONE_NAME;
        const apiToken = process.env.BRIGHTDATA_API_TOKEN;

        if (!customerId || !zoneName || !apiToken) {
            res.status(500).send({error: "Server configuration error: Missing Bright Data secrets."});
            return;
        }

        // 3. BRIGHT DATA API CALL
        const credentials = Buffer.from(
          `lum-customer-${customerId}-zone-${zoneName}:${apiToken}`
        ).toString("base64");

        const payload = {
          source: "google_news",
          query: query,
          language_code: languageCode || "en",
          num: 10,
        };

        const response = await fetch(BRIGHTDATA_ENDPOINT, {
          method: "POST",
          headers: {
            "Authorization": `Basic ${credentials}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        } as RequestInit);

        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        const apiResponse: any = await response.json();

        if (!response.ok) {
          logger.error("Bright Data API Error (fetchNews):", apiResponse);
          res.status(response.status).send({
            error: "Bright Data API returned an error.",
            details: apiResponse.error?.message || JSON.stringify(apiResponse),
          });
          return;
        }

        const newsResults = apiResponse.news_results || apiResponse.organic || [];
        
        // 4. SUCCESS RESPONSE
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        res.status(200).send(newsResults.map((item: any) => ({
          title: item.title,
          snippet: item.snippet,
          link: item.link,
          source: item.source,
          date: item.date,
        })));
      } catch (error) {
        const message = (error as Error).message;
        const status = message.includes("Unauthenticated") || message.includes("Invalid") ? 401 : 500;
        logger.error("Function Error (fetchNews):", error);
        res.status(status).send({error: message});
      }
  });


// ----------------------------------------------------------------------
// CLOUD FUNCTION 2: createLesson (HTTP FUNCTION)
// ----------------------------------------------------------------------

export const createLesson = onRequest(
  {secrets: ALL_SECRETS, timeoutSeconds: 60, cors: true},
  async (req, res) => {
    // CORS now handled by `cors: true` option (for production)
    // and Vite proxy (for local development)
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }

    let userId: string;
    try {
        // 1. AUTHENTICATION CHECK
        userId = await getAuthenticatedUid(req);
    } catch (e) {
        res.status(401).send({error: `Unauthenticated: ${(e as Error).message}`});
        return;
    }

    const data = req.body;
    const articleUrl = data?.articleUrl;
    const level = data?.level;

    if (!articleUrl || !level) {
      res.status(400).send({error: "Missing article URL or level."});
      return;
    }

    let articleContent = "";

    try {
      // --- STEP A: SCRAPE FULL ARTICLE TEXT ---
      const customerId = process.env.BRIGHTDATA_CUSTOMER_ID;
      const zoneName = process.env.BRIGHTDATA_ZONE_NAME;
      const apiToken = process.env.BRIGHTDATA_API_TOKEN;
      
      if (!customerId || !zoneName || !apiToken) {
        throw new Error("Bright Data secrets are not configured on the server.");
      }

      // Use the proxy to scrape the article content
      const proxyAgent = new HttpsProxyAgent(
        `http://lum-customer-${customerId}-zone-${zoneName}` +
            `-session-rand:${apiToken}@zproxy.lum-superproxy.io:22225`
      );

      const proxyResponse = await fetch(articleUrl, {
        method: "GET",
        agent: proxyAgent,
      } as RequestInit);

      if (!proxyResponse.ok) {
        throw new Error(`Scraping failed with status: ${proxyResponse.status}`);
      }

      const html = await proxyResponse.text();
      articleContent = extractArticleText(html);

      if (articleContent.length < 100) {
        throw new Error(
          `Could not extract meaningful article content.
           Website might be too complex or blocked.`
        );
      }

      // --- STEP B: GENERATE LESSON WITH GEMINI ---
      const geminiApiKey = process.env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        throw new Error("GEMINI_API_KEY secret is not set.");
      }

      const ai = new GoogleGenAI({apiKey: geminiApiKey});

      const systemInstruction =
            "You are an expert English language teaching assistant. Your " +
            "goal is to generate structured learning material from a news " +
            `article. The user's English level is ${level}. Provide the ` +
            "following sections in a JSON object format.";

      const userPrompt =
            "Generate the lesson based on the following article content:\n\n" +
            `---\n${articleContent}\n---`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{role: "user", parts: [{text: userPrompt}]}],
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              articleTitle: { type: "STRING" },
              vocabularyList: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    word: {type: "STRING"},
                    definition: {type: "STRING"},
                    articleExample: {type: "STRING"},
                  },
                  required: ["word", "definition", "articleExample"],
                },
              },
              comprehensionQuestions: { type: "ARRAY", items: {type: "STRING"}},
              grammarFocus: {
                type: "OBJECT",
                properties: {
                  topic: {type: "STRING"},
                  explanation: {type: "STRING"},
                },
                required: ["topic", "explanation"],
              },
            },
            required: ["articleTitle", "vocabularyList", "comprehensionQuestions", "grammarFocus"],
          },
        },
      });

      const responseText = response.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!responseText) {
        throw new Error("Gemini response was empty or invalid.");
      }

      const lessonJson = JSON.parse(responseText);

      // 3. SUCCESS RESPONSE
      res.status(200).send({
        success: true,
        lesson: lessonJson,
        originalArticleUrl: articleUrl,
        userId: userId
      });
    } catch (e) {
        const message = (e as Error).message;
        const status = message.includes("Unauthenticated") || message.includes("Invalid") ? 401 : 500;
        logger.error("Function Error (createLesson):", e);
        res.status(status).send({error: `AI or Scraping Failed: ${message}`});
    }
  });
