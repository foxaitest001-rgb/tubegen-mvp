/**
 * Curate VidProM + Lunara datasets into a usable JSON for the Consultant
 * Extracts ~50K high-quality prompts organized by category
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createReadStream } from 'fs';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RAW_DIR = path.join(__dirname, '../datasets_raw');
const OUTPUT_FILE = path.join(__dirname, '../src/data/prompt_knowledge.json');

// Categories we want to extract
const STYLE_CATEGORIES = {
    cinematic: ['cinematic', 'film', 'movie', 'cinema', 'dramatic', 'epic'],
    horror: ['horror', 'scary', 'dark', 'creepy', 'nightmare', 'terrifying'],
    scifi: ['sci-fi', 'futuristic', 'space', 'cyberpunk', 'robot', 'alien'],
    fantasy: ['fantasy', 'magic', 'dragon', 'wizard', 'mythical', 'enchanted'],
    nature: ['nature', 'forest', 'ocean', 'landscape', 'wildlife', 'sunset'],
    anime: ['anime', 'manga', 'japanese', 'studio ghibli', 'kawaii'],
    documentary: ['documentary', 'realistic', 'educational', 'historical'],
    action: ['action', 'explosion', 'chase', 'fight', 'battle', 'combat'],
    emotional: ['emotional', 'sad', 'happy', 'love', 'heartbreak', 'tears'],
    aesthetic: ['aesthetic', 'beautiful', 'artistic', 'minimalist', 'elegant']
};

// Technical terms to boost
const TECHNICAL_TERMS = [
    'wide shot', 'close-up', 'dolly', 'tracking', 'crane', 'handheld',
    'golden hour', 'blue hour', 'bokeh', 'depth of field', 'lens flare',
    '4k', '8k', 'HDR', 'anamorphic', 'slow motion', 'time-lapse'
];

async function parseVidProM() {
    const filePath = path.join(RAW_DIR, 'VidProM_unique.csv');
    if (!fs.existsSync(filePath)) {
        console.log('⚠️ VidProM not found. Run download_datasets.js first.');
        return [];
    }

    console.log('📖 Parsing VidProM (this may take a minute)...');

    const prompts = [];
    const fileStream = createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let lineNum = 0;
    for await (const line of rl) {
        lineNum++;
        if (lineNum === 1) continue; // Skip header

        // CSV format: prompt,model,timestamp (we only need prompt)
        const prompt = line.split(',')[0]?.replace(/^"|"$/g, '').trim();
        if (prompt && prompt.length > 20 && prompt.length < 500) {
            prompts.push(prompt);
        }

        // Progress indicator
        if (lineNum % 100000 === 0) {
            process.stdout.write(`\r  Processed: ${(lineNum / 1000000).toFixed(1)}M lines`);
        }
    }

    console.log(`\n✅ Found ${prompts.length.toLocaleString()} valid prompts`);
    return prompts;
}

function categorizePrompts(prompts) {
    console.log('🏷️  Categorizing prompts...');

    const categorized = {};
    for (const category of Object.keys(STYLE_CATEGORIES)) {
        categorized[category] = [];
    }
    categorized.technical = [];
    categorized.general = [];

    for (const prompt of prompts) {
        const lower = prompt.toLowerCase();
        let matched = false;

        // Check style categories
        for (const [category, keywords] of Object.entries(STYLE_CATEGORIES)) {
            if (keywords.some(kw => lower.includes(kw))) {
                if (categorized[category].length < 5000) { // Max 5K per category
                    categorized[category].push(prompt);
                }
                matched = true;
                break;
            }
        }

        // Check technical terms
        if (!matched && TECHNICAL_TERMS.some(t => lower.includes(t))) {
            if (categorized.technical.length < 5000) {
                categorized.technical.push(prompt);
            }
            matched = true;
        }

        // General bucket
        if (!matched && categorized.general.length < 10000) {
            categorized.general.push(prompt);
        }
    }

    return categorized;
}

async function main() {
    console.log('🚀 Prompt Curation Tool\n');

    // Parse VidProM
    const vidpromPrompts = await parseVidProM();

    // Categorize
    const categorized = categorizePrompts(vidpromPrompts);

    // Count totals
    let total = 0;
    for (const [cat, prompts] of Object.entries(categorized)) {
        console.log(`  ${cat}: ${prompts.length.toLocaleString()} prompts`);
        total += prompts.length;
    }

    console.log(`\n📊 Total curated: ${total.toLocaleString()} prompts`);

    // Save to JSON
    const outputDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(categorized, null, 2));
    const sizeMB = (fs.statSync(OUTPUT_FILE).size / 1024 / 1024).toFixed(2);

    console.log(`\n🎉 Saved to: ${OUTPUT_FILE}`);
    console.log(`📦 File size: ${sizeMB} MB`);
}

main().catch(console.error);
