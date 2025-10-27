import * as functions from "firebase-functions";
import {onRequest} from "firebase-functions/v2/https";
import fetch, {RequestInit} from "node-fetch";
import * as cheerio from "cheerio";
import {GoogleGenAI} from "@google/genai";
// FIX 1: Change require to dynamic import and
// cast to any to resolve ESLint issue
// and retain module compatibility workaround.
// Also update the import to use the appropriate type for RequestInit.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const HttpsProxyAgent = require("https-proxy-agent");
import * as logger from "firebase-functions/logger";

// ----------------------------------------------------------------------
// SECRET CONFIGURATION
// ----------------------------------------------------------------------

const BRIGHTDATA_SECRETS = [
  "BRIGHTDATA_CUSTOMER_ID",
  "BRIGHTDATA_ZONE_NAME",
  "BRIGHTDATA_API_TOKEN",
];
const BRIGHTDATA_ENDPOINT =
    "https://zproxy.lum-superproxy.io:22225/serp";

const GEMINI_SECRETS = ["GEMINI_API_KEY"];
const ALL_SECRETS = [...BRIGHTDATA_SECRETS, ...GEMINI_SECRETS];

// ----------------------------------------------------------------------
// HELPER FUNCTION: HTML Content Extraction (SCRIBING)
// ----------------------------------------------------------------------

/**
 * Attempts to parse HTML content using Cheerio to find the main article body.
 * @param {string} html The raw HTML content of the page.
 * @return {string} The extracted and cleaned
 *  article text, limited to 8000 characters.
 */
function extractArticleText(html: string): string {
  const $ = cheerio.load(html);

  // Look for common article containers.
  const articleElements =
        "article, .article-body, .post-content, main";

  let articleText = "";
  $(articleElements).each((_i, elem) => {
    const text = $(elem).text().trim();
    if (text.length > articleText.length) {
      articleText = text;
    }
  });

  if (articleText.length < 200) {
    // Fallback: Grab all paragraph text if no clear article body found
    articleText = $("p").map((_i, el) => $(el).text()).get()
      .join("\n").trim();
  }

  // Clean up excessive whitespace and limit text size for prompt
  return articleText.replace(/(\n\s*){3,}/g, "\n\n")
    .substring(0, 8000);
}

// ----------------------------------------------------------------------
// AUTHENTICATION HELPER
// ----------------------------------------------------------------------

/**
 * Ensures the request is authenticated (essential for protecting paid APIs).
 * In a production V2 HTTP function, this would check a token.
 * For this initial draft, we'll implement a placeholder check.
 * @param {functions.https.Request} req The incoming HTTPS request object.
 * @return {boolean} True if the request is authenticated, false otherwise.
 */
function isAuthenticated(req: functions.https.Request): boolean {
  // NOTE: This is a PLACEHOLDER. In your production app,
  // you must implement JWT verification (e.g., Firebase ID Token).
  return !!req.headers.authorization;
}

// ----------------------------------------------------------------------
// CLOUD FUNCTION 1: fetchNews (V2 HTTP FUNCTION)
// ----------------------------------------------------------------------

export const fetchNews = onRequest(
  {secrets: BRIGHTDATA_SECRETS, cors: true, invoker: "public"},
  async (req, res) => {
      // Type definition for request data
      type FetchNewsData = {
          query: string;
          languageCode?: string;
      };

      // 1. AUTHENTICATION CHECK
      if (!isAuthenticated(req)) {
        res.status(401).send({error: `Unauthenticated:
          Missing Authorization header.`});
        return;
      }

      // 2. DATA EXTRACTION (Handles GET query params or POST body)
      const data: FetchNewsData = {
        query: req.query.query as string || req.body.query as string,
        languageCode: req.query.languageCode as string ||
          req.body.languageCode as string,
      };

      if (!data.query) {
        res.status(400).send({error: "The 'query' parameter is required."});
        return;
      }

      const customerId = process.env.BRIGHTDATA_CUSTOMER_ID;
      const zoneName = process.env.BRIGHTDATA_ZONE_NAME;
      const apiToken = process.env.BRIGHTDATA_API_TOKEN;

      if (!customerId || !zoneName || !apiToken) {
        logger.error(
          "Secret Configuration Error: Bright Data SERP credentials missing."
        );
        res.status(500).send({error: "Server configuration error."});
        return;
      }

      const credentials = Buffer.from(
        `lum-customer-${customerId}-zone-${zoneName}:${apiToken}`
      ).toString("base64");

      const payload = {
        source: "google_news",
        query: data.query,
        language_code: data.languageCode || "en",
        num: 10,
      };

      try {
        const response = await fetch(BRIGHTDATA_ENDPOINT, {
          method: "POST",
          headers: {
            "Authorization": `Basic ${credentials}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        } as RequestInit);

        // FIX 2: Add explicit rule disabling for the raw API response type
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        const apiResponse: any = await response.json();

        if (!response.ok) {
          logger.error("Bright Data API Error (fetchNews):",
            apiResponse);
          res.status(response.status).send({
            error: "Bright Data API returned an error.",
            details: apiResponse,
          });
          return;
        }

        const newsResults =
          apiResponse.news_results || apiResponse.organic || [];

        // 3. SUCCESS RESPONSE
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        res.status(200).send(newsResults.map((item: any) => ({
          title: item.title,
          snippet: item.snippet,
          link: item.link,
          source: item.source,
          date: item.date,
        })));
      } catch (error) {
        logger.error("Function Error (fetchNews):", error);
        res.status(500).send({error: "Failed to fetch news articles."});
      }
  });


// ----------------------------------------------------------------------
// CLOUD FUNCTION 2: createLesson (V2 HTTP FUNCTION)
// ----------------------------------------------------------------------

/**
 * Cloud Function: createLesson
 * Purpose: Scrapes article content using Bright Data proxy and generates
 * a lesson using Gemini.
 */
export const createLesson = onRequest(
  {secrets: ALL_SECRETS, timeoutSeconds: 60, cors: true, invoker: "public"},
  async (req, res) => {
    // Type definition for request data
    type CreateLessonData = {
        articleUrl: string;
        level: string;
    };

    // 1. AUTHENTICATION CHECK
    if (!isAuthenticated(req)) {
      res.status(401).send({error: `Unauthenticated:
       Missing Authorization header.`});
      return;
    }

    // 2. DATA EXTRACTION
    const data: CreateLessonData = {
      articleUrl: req.query.articleUrl as string ||
       req.body.articleUrl as string,
      level: req.query.level as string || req.body.level as string,
    };

    if (!data.articleUrl || !data.level) {
      res.status(400).send({error: "Missing article URL or level."});
      return;
    }

    let articleContent = "";

    // --- STEP A: SCRAPE FULL ARTICLE TEXT ---
    try {
      const customerId = process.env.BRIGHTDATA_CUSTOMER_ID;
      const zoneName = process.env.BRIGHTDATA_ZONE_NAME;
      const apiToken = process.env.BRIGHTDATA_API_TOKEN;

      // Correctly instantiate HttpsProxyAgent using the required module
      const proxyAgent = new HttpsProxyAgent(
        `http://lum-customer-${customerId}-zone-${zoneName}` +
            `-session-rand:${apiToken}@zproxy.lum-superproxy.io:22225`
      );

      logger.info(`Attempting to scrape: ${data.articleUrl}`);

      const proxyResponse = await fetch(data.articleUrl, {
        method: "GET",
        agent: proxyAgent,
      } as RequestInit);

      if (!proxyResponse.ok) {
        logger.error(`Scraping HTTP Status Error: ${proxyResponse.status}`);
        throw new Error(
          `Scraping failed with status: ${proxyResponse.status}`
        );
      }

      const html = await proxyResponse.text();
      articleContent = extractArticleText(html);

      if (articleContent.length < 100) {
        throw new Error(
          `Could not extract meaningful article content.
           Website too complex or blocked.`
        );
      }
    } catch (e) {
      logger.error("Scraping Error:", e);
      res.status(500).send({
        error: "Failed to retrieve article content.",
        details: (e as Error).message,
      });
      return;
    }


    // --- STEP B: GENERATE LESSON WITH GEMINI ---
    try {
      const geminiApiKey = process.env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        throw new Error("GEMINI_API_KEY secret is not set.");
      }

      const ai = new GoogleGenAI({apiKey: geminiApiKey});

      const systemInstruction =
            "You are an expert English language teaching assistant. Your " +
            "goal is to generate structured learning material from a news " +
            `article. The user's English level is ${data.level}. Provide the ` +
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
              articleTitle: {
                type: "STRING",
                description: "The title of the article.",
              },
              vocabularyList: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    word: {type: "STRING"},
                    definition: {
                      type: "STRING",
                      description: "Simple, level-appropriate definition.",
                    },
                    articleExample: {
                      type: "STRING",
                      description: "A sentence or phrase containing the word," +
                                            " copied directly from the " +
                                            "article text.",
                    },
                  },
                  required: [
                    "word",
                    "definition",
                    "articleExample",
                  ],
                },
              },
              comprehensionQuestions: {
                type: "ARRAY",
                items: {type: "STRING"},
                description: "3-5 questions testing understanding of the main" +
                                " points, appropriate difficulty for the " +
                                "user's level.",
              },
              grammarFocus: {
                type: "OBJECT",
                properties: {
                  topic: {
                    type: "STRING",
                    description: "The grammar topic identified (e.g., Passive" +
                                        " Voice, Present Perfect).",
                  },
                  explanation: {
                    type: "STRING",
                    description: "A brief explanation of the grammar topic " +
                                        "suitable for the user's level.",
                  },
                },
                required: ["topic", "explanation"],
              },
            },
            required: [
              "articleTitle",
              "vocabularyList",
              "comprehensionQuestions",
              "grammarFocus",
            ],
          },
        },
      });

      const responseText =
            response.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!responseText) {
        throw new Error("Gemini response structure invalid or empty.");
      }

      const lessonJson = JSON.parse(responseText);

      logger.info("Lesson Generated Successfully.");

      // 3. SUCCESS RESPONSE
      res.status(200).send({
        success: true,
        lesson: lessonJson,
        originalArticleUrl: data.articleUrl,
      });
    } catch (e) {
      logger.error("Gemini/Lesson Error:", e);
      res.status(500).send({
        error: "AI lesson generation failed.",
        details: (e as Error).message,
      });
    }
  });
