
import { BrightDataArticle, BrightDataResponse } from '../types';

// --- PLACEHOLDER CREDENTIALS ---
// These are provided for the purpose of this draft.
// In a real application, these must be kept secret.
const BRIGHTDATA_CUSTOMER_ID = '';
const BRIGHTDATA_ZONE_NAME = '';
const BRIGHTDATA_API_TOKEN = '';
// --- END PLACEHOLDER CREDENTIALS ---

const API_ENDPOINT = 'https://zproxy.lum-superproxy.io:22225/serp';
const USERNAME = `lum-customer-${BRIGHTDATA_CUSTOMER_ID}-zone-${BRIGHTDATA_ZONE_NAME}`;
const PASSWORD = BRIGHTDATA_API_TOKEN;

// IMPORTANT: In a production application, this entire function MUST be moved to a
// secure backend environment (e.g., a Cloud Function or a server).
// Making this call directly from the frontend exposes your Bright Data credentials
// and can lead to security vulnerabilities and abuse of your account.
// It will also likely fail due to browser CORS (Cross-Origin Resource Sharing) policies.

export const fetchNewsArticles = async (interests: string): Promise<BrightDataArticle[]> => {
    const headers = new Headers();
    headers.append('Authorization', 'Basic ' + btoa(`${USERNAME}:${PASSWORD}`));
    headers.append('Content-Type', 'application/json');

    const body = JSON.stringify({
        source: 'google_news',
        query: interests,
        language_code: 'en',
        num: 10,
    });

    try {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: headers,
            body: body,
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error('Bright Data API Error Response:', errorBody);
            throw new Error(`Bright Data API responded with status: ${response.status}`);
        }

        const data: BrightDataResponse = await response.json();
        
        // The API response can have different structures. Check for `organic` or `news_results`.
        if ('organic' in data && Array.isArray(data.organic)) {
            return data.organic;
        }
        if ('news_results' in data && Array.isArray(data.news_results)) {
            return data.news_results;
        }

        console.warn("No 'organic' or 'news_results' found in Bright Data response", data);
        return [];

    } catch (error) {
        console.error('Error fetching news articles from Bright Data:', error);
        // This is a common error if running in a browser without a CORS proxy.
        if (error instanceof TypeError) {
             throw new Error('A network error occurred. This may be due to browser CORS policy. This API call should be made from a backend server.');
        }
        throw new Error('Failed to fetch news articles.');
    }
};
