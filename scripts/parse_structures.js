
import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';
import mammoth from 'mammoth';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STRUCTURE_DIR = path.join(__dirname, '../structure');
const OUTPUT_FILE = path.join(__dirname, '../src/data/cinematic_knowledge.json');

async function parseStructures() {
    if (!fs.existsSync(STRUCTURE_DIR)) {
        console.error(`Directory not found: ${STRUCTURE_DIR}`);
        return;
    }

    const files = fs.readdirSync(STRUCTURE_DIR);
    const results = {};

    console.log(`Scanning ${STRUCTURE_DIR}...`);

    for (const file of files) {
        const filePath = path.join(STRUCTURE_DIR, file);
        const ext = path.extname(file).toLowerCase();
        const baseName = path.basename(file, ext).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

        if (ext === '.xlsx') {
            try {
                const workbook = xlsx.readFile(filePath);
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                const jsonData = xlsx.utils.sheet_to_json(sheet);
                results[baseName] = jsonData;
                console.log(`✅ Parsed Excel: ${file}`);
            } catch (err) {
                console.error(`❌ Error parsing Excel ${file}:`, err.message);
            }
        } else if (ext === '.docx') {
            try {
                const buffer = fs.readFileSync(filePath);
                const result = await mammoth.extractRawText({ buffer });
                results[baseName] = result.value; // Raw text
                console.log(`✅ Parsed Word: ${file}`);
            } catch (err) {
                console.error(`❌ Error parsing Word ${file}:`, err.message);
            }
        }
    }

    // Ensure output directory exists
    const outDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    console.log(`\n🎉 Successfully saved knowledge to: ${OUTPUT_FILE}`);
}

parseStructures();
