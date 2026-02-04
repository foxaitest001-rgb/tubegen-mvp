
import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STRUCTURE_DIR = path.join(__dirname, '../structure');

async function parseStructures() {
    if (!fs.existsSync(STRUCTURE_DIR)) {
        console.error(`Directory not found: ${STRUCTURE_DIR}`);
        return;
    }

    const files = fs.readdirSync(STRUCTURE_DIR);
    const results = [];

    for (const file of files) {
        const filePath = path.join(STRUCTURE_DIR, file);
        const ext = path.extname(file).toLowerCase();

        if (ext === '.xlsx') {
            try {
                const workbook = xlsx.readFile(filePath);
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                const headers = xlsx.utils.sheet_to_json(sheet, { header: 1 })[0];
                results.push({ file, headers });
            } catch (err) {
                results.push({ file, error: err.message });
            }
        }
    }

    console.log(JSON.stringify(results, null, 2));
}

parseStructures();
