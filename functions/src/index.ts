import * as functions from "firebase-functions";
import {onRequest} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import fetch, {RequestInit} from "node-fetch";
import * as cheerio from "cheerio";
import {GoogleGenAI} from "@google/genai";
import * as logger from "firebase-functions/logger";
import { HttpsProxyAgent } from "https-proxy-agent";

// --- Firebase Admin Helper (with LAZY INITIALIZATION) ---
async function getAuthenticatedUid(req: functions.https.Request): Promise<string> {
    if (!admin.apps.length) {
        admin.initializeApp();
    }
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

// ----------------------------------------------------------------------
// CONFIGURATION
// ----------------------------------------------------------------------
const SCRAPER_API_ENDPOINT = "https://api.brightdata.com/request";

// --- Cheerio Helper (Only for createLesson) ---
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
// CLOUD FUNCTION 1: fetchNews (using SERP API with JSON response)
// ----------------------------------------------------------------------
export const fetchNews = onRequest(
  {secrets: ["BRIGHTDATA_API_KEY", "BRIGHTDATA_SERP_ZONE_NAME"], cors: true},
  async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
      try {
        await getAuthenticatedUid(req);
        const { query, languageCode = "en" } = req.body;
        if (!query) { res.status(400).send({error: "The 'query' parameter is required."}); return; }

        const apiKey = process.env.BRIGHTDATA_API_KEY;
        const zoneName = process.env.BRIGHTDATA_SERP_ZONE_NAME;
        if (!apiKey || !zoneName) {
            logger.error("Secret Configuration Error: SERP API secrets missing.");
            res.status(500).send({error: "Server configuration error."}); return;
        }

        const targetUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=${languageCode}&tbm=nws`;
        
        // CRITICAL FIX: Request structured JSON, not raw HTML.
        const payload = {
          zone: zoneName,
          url: targetUrl,
          format: "json"
        };

        const response = await fetch(SCRAPER_API_ENDPOINT, {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        } as RequestInit);

        if (!response.ok) {
          const errorText = await response.text();
          logger.error("Bright Data SERP API Error (fetchNews):", errorText);
          res.status(response.status).send({ error: "Bright Data SERP API returned an error.", details: errorText }); return;
        }
        
        // NO MORE CHEERIO! We now process a direct JSON response.
        const apiResponse: any = await response.json();
        
        // The SERP API returns a structured array, often called "organic" or "news_results".
        const newsResults = apiResponse.organic || apiResponse.news_results || [];
        
        logger.info(`Received ${newsResults.length} structured articles directly from Bright Data.`);

        // Map the clean JSON data to our desired format.
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
// CLOUD FUNCTION 2: createLesson (using Proxy-based access)
// ----------------------------------------------------------------------
export const createLesson = onRequest(
  {secrets: ["SBR_ZONE_FULL_USERNAME", "SBR_ZONE_PASSWORD", "GEMINI_API_KEY"], timeoutSeconds: 60, cors: true},
  async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    try {
        const userId = await getAuthenticatedUid(req);
        const { articleUrl, level } = req.body;
        if (!articleUrl || !level) { res.status(400).send({error: "Missing article URL or level."}); return; }
        
        const username = process.env.SBR_ZONE_FULL_USERNAME;
        const password = process.env.SBR_ZONE_PASSWORD;
        if (!username || !password) {
            logger.error("Secret Configuration Error: Browser Zone secrets missing.");
            res.status(500).send({error: "Server configuration error."}); return;
        }
        
        // This function MUST use a proxy, because it's accessing an arbitrary URL
        const proxyUrl = `http://${username}:${password}@brd.superproxy.io:22225`;
        const proxyAgent = new HttpsProxyAgent(proxyUrl);

        const proxyResponse = await fetch(articleUrl, {
            agent: proxyAgent,
            method: "GET"
        } as RequestInit);
        
        if (!proxyResponse.ok) { throw new Error(`Scraping failed with status: ${proxyResponse.status}, ${await proxyResponse.text()}`); }
        
        const html = await proxyResponse.text();
        const articleContent = extractArticleText(html); // Cheerio is correct here
        if (articleContent.length < 100) { throw new Error("Could not extract meaningful article content."); }
        
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
	        res.status(200).send({ success: true, lesson: lessonJson, originalArticleUrl: articleUrl, userId });

    } catch (e) {
        const message = (e as Error).message;
        const status = message.includes("Unauthenticated") || message.includes("Invalid") ? 401 : 500;
        logger.error("Function Error (createLesson):", e);
        res.status(status).send({error: `AI or Scraping Failed: ${message}`});
    }
  });