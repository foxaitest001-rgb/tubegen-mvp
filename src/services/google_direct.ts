
import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;

// --- GENERATIVE AI (GEMINI) ---

// WORKING MODEL: gemini-3-flash-preview (Confirmed by user logs)
// Fallback: gemini-2.0-flash (may rate limit)
// Fallback: gemini-1.5-pro (Try as last resort for quota)
const FALLBACK_MODELS: string[] = [
    'gemini-2.0-flash',
    'gemini-1.5-pro'
];

export async function generateContentWithGoogle(systemPrompt: string, userQuery: string, primaryModel: string = 'gemini-3-flash-preview') {
    if (!API_KEY) throw new Error("Missing VITE_GOOGLE_API_KEY in .env");

    const genAI = new GoogleGenerativeAI(API_KEY);
    const combinedPrompt = `${systemPrompt}\n\nUSER REQUEST: ${userQuery}`;

    // Ensure primary model is tried first, then fallbacks
    // Start with primaryModel, then iterate through FALLBACKS
    const modelsToTry = [primaryModel, ...FALLBACK_MODELS.filter(m => m !== primaryModel)];

    let lastError;

    for (const modelName of modelsToTry) {
        // Robust Retry Logic for Rate Limits
        const MAX_RETRIES = 1; // Effective retries after wait
        let retries = 0;

        while (retries <= MAX_RETRIES) {
            try {
                const attemptLabel = retries > 0 ? `(Retry ${retries}/${MAX_RETRIES})` : '';
                console.log(`[Google Direct] Attempting generation with ${modelName} ${attemptLabel}...`);

                const model = genAI.getGenerativeModel({ model: modelName });

                const result = await model.generateContent(combinedPrompt);
                const response = await result.response;
                const text = response.text();

                console.log(`[Google Direct] Success with ${modelName}. Response length: ${text.length}`);

                // Clean Markdown for JSON parsing
                const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();

                try {
                    return JSON.parse(cleaned);
                } catch (e: any) {
                    console.warn(`[Google Direct] JSON Parse failed for ${modelName}. Returning raw text.`);
                    // If it's not JSON, it might be the raw prompt requested (like for Thumbnails).
                    // Return the text directly.
                    return cleaned;
                }

            } catch (error: any) {
                console.warn(`[Google Direct] Failed with ${modelName}:`, error.message.substring(0, 100));
                lastError = error;

                // If rate limited (429) or Service Unavailable (503), wait and RETRY the SAME model
                if (error.message.includes('429') || error.message.includes('503') || error.message.includes('quota')) {
                    if (retries < 1) {
                        // User Request: Skip erratic retries, go straight to long wait
                        const waitTime = 30000; // 30 seconds (Quota limits usually reset in 60s window)
                        console.log(`[Google Direct] ⚠️ High Traffic (429/503). Waiting ${waitTime / 1000}s before FINAL retry...`);
                        await new Promise(r => setTimeout(r, waitTime));
                        retries++;
                        continue; // LOOP AGAIN with same model
                    }
                }

                // If critical error (not 429) OR max retries exhausted, break inner loop to try NEXT model
                break;
            }
        }
    }

    // If we get here, all models failed
    console.error("[Google Direct] All models failed.");
    throw lastError;
}

// --- TEXT TO SPEECH (GOOGLE TTS REST API) ---

export async function generateTTSWithGoogle(text: string, voiceName: string = 'en-US-Journey-D') {
    if (!API_KEY) throw new Error("Missing VITE_GOOGLE_API_KEY");

    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${API_KEY}`;

    // escape XML characters to avoid 400 errors
    const safeText = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    // Journey Voices (Generative) DO NOT support SSML Prosody.
    // We must send raw text for them to work.
    const isJourney = voiceName.includes('Journey');

    // Professional Audio Polish: -1.5st Pitch, Loud Volume
    // Only apply if NOT Journey
    const ssml = isJourney
        ? undefined
        : `<speak><prosody rate="1.0" pitch="-1.5st" volume="loud">${safeText}</prosody></speak>`;

    // Log for clarity
    if (isJourney) console.log(`[Google TTS] Journey voice detected. Skipping SSML polish (Not Supported).`);

    const requestBody = {
        input: ssml ? { ssml: ssml } : { text: text }, // Auto-switch
        voice: {
            languageCode: 'en-US',
            name: voiceName
        },
        audioConfig: { audioEncoding: 'MP3' }
    };

    let attempts = 0;
    const maxAttempts = 3;

    // Helper to perform the fetch
    const performFetch = async (body: any) => {
        return await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    };

    while (attempts < maxAttempts) {
        try {
            console.log(`[Google TTS] Attempt ${attempts + 1}/${maxAttempts} for: "${text.substring(0, 20)}..."`);

            // Try with SSML (Polish) first
            let response = await performFetch(requestBody);

            if (!response.ok) {
                const err = await response.json();
                console.warn(`[Google TTS] SSML Attempt Failed:`, JSON.stringify(err));

                // If error is 400 (Invalid Argument), meaningful for Journey/Polyglot voices -> Fallback to TEXT
                if (response.status === 400) {
                    console.warn(`[Google TTS] ⚠️ Voice might not support SSML. Falling back to plain TEXT (No Polish).`);
                    const fallbackBody = {
                        input: { text: text }, // Raw text, no polish
                        voice: requestBody.voice,
                        audioConfig: requestBody.audioConfig
                    };
                    response = await performFetch(fallbackBody);

                    if (!response.ok) {
                        const fallbackErr = await response.json();
                        throw new Error(`Google TTS Text Fallback Failed: ${JSON.stringify(fallbackErr)}`);
                    }
                } else if (response.status === 403 || response.status === 429) {
                    // Quota/Rate Limit - Throw to trigger retry loop
                    throw new Error(`Google TTS Rate Limit/Quota: ${response.status}`);
                } else {
                    throw new Error(`Google TTS API Error: ${JSON.stringify(err)}`);
                }
            }

            const result = await response.json();
            return `data:audio/mp3;base64,${result.audioContent}`;

        } catch (error: any) {
            console.warn(`[Google TTS] Attempt ${attempts + 1} Error:`, error.message);

            if (error.message.includes("Rate Limit") || error.message.includes("Quota")) {
                attempts++;
                if (attempts < maxAttempts) {
                    const waitT = 2000 * attempts;
                    console.log(`[Google TTS] Retrying in ${waitT / 1000} seconds...`);
                    await new Promise(r => setTimeout(r, waitT));
                } else {
                    // All retries exhausted for rate limit/quota
                    return null;
                }
            } else {
                // If it's a hard error (like 400 fallback failed, or other non-retryable errors),
                // we don't increment attempts for these, just return null or re-throw if desired.
                // For now, we'll just return null as per original logic for non-retryable errors.
                return null;
            }
        }
    }
    return null;
}
