
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.VITE_GOOGLE_API_KEY;

if (!API_KEY) {
    console.error("No API Key found in env!");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(API_KEY);

async function listModels() {
    console.log("Checking available models for key ending in...", API_KEY.slice(-4));
    try {
        // There isn't a direct listModels on the simplified client sometimes, 
        // but we can try the model query or just test specific names.
        // Actually the server-side SDK has listModels, client SDK might not via this class directly 
        // depending on version, but let's try a direct fetch if SDK fails.

        // Let's try testing the requested names directly.
        const candidates = [
            "gemini-2.0-flash",
            "gemini-2.0-flash-exp",
            "gemini-1.5-pro",
            "gemini-1.5-flash",
            "gemini-1.5-flash-001",
            "gemini-1.5-flash-latest",
            "gemini-pro",
            "gemini-1.0-pro"
        ];

        for (const modelName of candidates) {
            process.stdout.write(`Testing ${modelName}... `);
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent("Hello, are you online?");
                const response = await result.response;
                console.log(`✅ OK!`);
            } catch (e) {
                if (e.message.includes("404")) console.log("❌ 404 Not Found");
                else if (e.message.includes("429")) console.log("⚠️ 429 Rate Limited (Exists but busy)");
                else console.log(`❌ Error: ${e.message.split('\n')[0]}`);
            }
        }

    } catch (e) {
        console.error("Fatal Error:", e);
    }
}

listModels();
