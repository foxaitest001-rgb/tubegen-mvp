
import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STRUCTURE_DIR = path.join(__dirname, '../structure');
const OUTPUT_FILE = path.join(__dirname, '../src/data/cinematic_knowledge.json');
const OUTPUT_DIR = path.dirname(OUTPUT_FILE);

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function convertStructures() {
    if (!fs.existsSync(STRUCTURE_DIR)) {
        console.error(`Directory not found: ${STRUCTURE_DIR}`);
        return;
    }

    const files = fs.readdirSync(STRUCTURE_DIR);
    const knowledgeBase = {};

    for (const file of files) {
        const filePath = path.join(STRUCTURE_DIR, file);
        const ext = path.extname(file).toLowerCase();
        const key = path.basename(file, ext).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

        if (ext === '.xlsx') {
            try {
                const workbook = xlsx.readFile(filePath);
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                const data = xlsx.utils.sheet_to_json(sheet);

                // Optimize: Convert array of objects to a more compact string representation for LLM context if too large
                // For now, keep as objects but limit headers if needed.
                knowledgeBase[key] = data;
                console.log(`Processed ${file} -> ${data.length} rows`);
            } catch (err) {
                console.error(`Error processing ${file}:`, err.message);
            }
        }
        // Word files logic could be added here if needed, skipping for now as Excel has the main "Structures"
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(knowledgeBase, null, 2));
    console.log(`Knowledge base saved to ${OUTPUT_FILE}`);
}

convertStructures();
