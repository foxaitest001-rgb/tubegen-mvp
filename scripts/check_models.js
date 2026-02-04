
import fs from 'fs';
import path from 'path';

try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) {
        console.error("No .env file found");
        process.exit(1);
    }
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/VITE_GOOGLE_API_KEY=(.*)/);
    const key = match ? match[1].trim() : null;

    if (!key) {
        console.error("No VITE_GOOGLE_API_KEY found in .env");
        process.exit(1);
    }

    console.log("Checking models for key ending in...", key.slice(-4));

    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;

    fetch(url)
        .then(res => res.json())
        .then(data => {
            if (data.models) {
                console.log("--- AVAILABLE GUIDED MODELS ---");
                data.models
                    .filter(m => m.supportedGenerationMethods.includes('generateContent'))
                    .forEach(m => console.log(`Name: ${m.name} | Display: ${m.displayName}`));
            } else {
                console.log("Error response:", JSON.stringify(data, null, 2));
            }
        })
        .catch(e => console.error("Fetch error:", e));

} catch (e) {
    console.error("Script error:", e);
}
