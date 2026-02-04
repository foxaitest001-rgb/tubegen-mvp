
const https = require('https');

const API_KEY = 'AIzaSyDrioX2XcoRI5SqMP3AN6YuGRitHOwxS0M';
const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

console.log(`Fetching models from: ${url.replace(API_KEY, 'HIDDEN')}`);

https.get(url, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            if (json.error) {
                console.error('API Error:', json.error);
            } else if (json.models) {
                console.log('--- AVAILABLE MODELS ---');
                json.models.forEach(m => {
                    // Filter for 'generateContent' capability
                    if (m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent')) {
                        console.log(`ID: ${m.name.replace('models/', '')} | Display: ${m.displayName}`);
                    }
                });
                console.log('-----------------------');
            } else {
                console.log('No models found or unexpected format:', json);
            }
        } catch (e) {
            console.error('Parse Error:', e);
            console.log('Raw Data:', data);
        }
    });

}).on('error', (err) => {
    console.error('Request Error:', err);
});
