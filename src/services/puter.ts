
// REFACTORED: Puter.js dependency removed. Now using Google Direct + Pollinations.ai + Piper (Local) + Puter (Video)

import { generateContentWithGoogle } from './google_direct';
import cinematicKnowledge from '../data/cinematic_knowledge.json';
import viralStrategies from '../data/viral_strategies.json';

const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;

// Facade for Gemini calls (formerly callGeminiViaPuter)
export async function callGeminiViaPuter(systemPrompt: string, userQuery: string) {
  if (!API_KEY) {
    throw new Error("Missing VITE_GOOGLE_API_KEY. Please add it to your .env file.");
  }
  console.log("[Service] Using Direct Google API Key (Puter Removed)");
  return await generateContentWithGoogle(systemPrompt, userQuery);
}

// Helper to summarize knowledge for the prompt
const getDirectorContext = () => {
  const cameraShots = (cinematicKnowledge as any).a_director_s_guide_to_cinematic_ai_visuals__best_practices_for_camera__lighting__and_pose_in_2025
    ?.slice(0, 8)
    .map((s: any) => `${s["Camera Shot"]}: ${s["Prompt Keywords & Narrative Impact"]}`)
    .join("; ") || "";

  const thumbnailUtils = (cinematicKnowledge as any).high_ctr_thumbnail_knowledge_table__deep_sea___prehistoric_niche_
    ?.[0] || {};
  const hookPrinciples = `Hook Principles: ${thumbnailUtils["Primary Emotion Trigger"] || ""} - ${thumbnailUtils["Thumbnail Goal"] || ""}`;

  return `
    DIRECTOR'S KNOWLEDGE BASE (Use this for visual descriptions):
    [Camera Specs]: ${cameraShots}
    [Hook Strategy]: ${hookPrinciples}
    [Lighting]: Motivated Realism (Deakins Principle) - light must have a source.
    `;
};

// Helper: Select the best strategy based on Niche keyword
const getRetentionStrategy = (niche: string) => {
  const lowerNiche = niche.toLowerCase();

  // Simple keyword matching to find the best archetype
  if (lowerNiche.includes('gam') || lowerNiche.includes('play') || lowerNiche.includes('minecraft') || lowerNiche.includes('roblox')) return viralStrategies.Gaming;
  if (lowerNiche.includes('tech') || lowerNiche.includes('review') || lowerNiche.includes('unbox') || lowerNiche.includes('apple')) return viralStrategies.Tech;
  if (lowerNiche.includes('money') || lowerNiche.includes('financ') || lowerNiche.includes('business') || lowerNiche.includes('crypto')) return viralStrategies.Finance;
  if (lowerNiche.includes('history') || lowerNiche.includes('docu') || lowerNiche.includes('crime') || lowerNiche.includes('mystery')) return viralStrategies.Documentary;
  if (lowerNiche.includes('horror') || lowerNiche.includes('scary') || lowerNiche.includes('creep')) return viralStrategies.Horror;
  if (lowerNiche.includes('health') || lowerNiche.includes('fit') || lowerNiche.includes('workout') || lowerNiche.includes('diet')) return viralStrategies.Health;
  if (lowerNiche.includes('vlog') || lowerNiche.includes('life') || lowerNiche.includes('daily')) return viralStrategies.Vlog;

  // Default to Universal if no specific match
  return viralStrategies.Universal;
};

export async function generateNarrative(topic: string, niche: string, referenceUrl?: string, videoLength?: string, voiceStyle?: string) {
  const strategy = getRetentionStrategy(niche);
  console.log(`[Service] Applied Viral Strategy: ${strategy.structure_name} for niche: ${niche}`);

  const directorContext = getDirectorContext();

  const systemPrompt = `You are a World-Class YouTube Scriptwriter, Cinematic Director, and Retention Expert.
  You specialize in the '${niche}' niche and assume the archetype of: ${strategy.structure_name}.
  
  GOAL: Create a viral retention-based script + detailed AI art prompts.
  
  ## CORE ARCHITECTURE: ${strategy.structure_name}
  You MUST adhere to this exact pacing structure tailored for this niche:
  
  **HOOK STRATEGY**: ${strategy.hook_strategy}
  **PACING RULE**: ${strategy.pacing}
  **EMOTIONAL ARC**: ${strategy.emotional_arc}

  ## RETENTION RULES (The "Secret Sauce"):
  ${strategy.retention_rules.map((r: string, i: number) => `${i + 1}. ${r}`).join('\n  ')}

  ## UNIVERSAL VIRAL STRUCTURE (Underlying Framework):
  1. **THE HOOK**: Execute the Hook Strategy above.
  2. **THE CONTEXT**: Why does this matter?
  3. **THE ESCALATION**: Raise stakes/complexity endlessly.
  4. **THE MIDPOINT**: Subvert expectations.
  5. **THE CLIMAX**: Payoff the hook.
  6. **THE OUTRO**: Quick loop.

  USER INPUT:
  - Topic: "${topic}"
  - Reference Style: ${referenceUrl || 'None'}
  - Target Word Count: ${videoLength || '1500 Words'}
  - Voice: ${voiceStyle || 'Conversational'}
  - **Voice Tone Instruction**: ${voiceStyle === 'Friendly'
      ? 'Read as an engaging, friendly guide sharing a fascinating story. Maintain a warm, clear, and approachable tone that feels like a conversation with an expert friend.'
      : 'Match the requested style.'}
  
  // NOTE: Initial visuals are just placeholders. The Frontend will call 'generateExactVisuals' later.
  6. **VISUAL PLACEHOLDER**:
     - Provide 1-2 generic "Establishing Shots" per scene. 
     - Do NOT waste tokens generating 10 shots here. 
     - The exact visual script will be generated AFTER the audio duration is confirmed.
  
  ${directorContext}

  PROCESS:
  1. **ANALYSIS PHASE**: Analyze niche/reference.
  2. **SCRIPT GENERATION**: Write a **MASSIVE, IN-DEPTH SCRIPT**.
     - **CRITICAL REQUIREMENT**: The user requested a Target Length of **${videoLength || '1500 Words'}**. 
     - **YOU MUST MEET THIS TARGET**. Do not summarize. Do not be concise.
     - **EXPANSION STRATEGY**: 
       * Deep dive into history/science/context for every point.
       * Use detailed examples, analogies, and sensory descriptions.
       * If the topic is simple, broaden the scope to related fields.
       * **The script must be long enough to match the requested word count.**
  3. **DIRECTOR PHASE**: Generated specific image/video prompts.
     - **MANDATORY FORMAT**: Each prompt string must be a rich 40-60 word paragraph.
     - **REQUIRED ELEMENTS**: Subject, Camera, Lighting, Motion, Atmosphere.

  RETURN JSON ONLY:
  {
    "hook": "First 15s lines...",
    "voice_style_recommendation": "...",
    "estimated_duration": "...",
    "structure": [
      { 
        "timestamp": "0:00-0:15", 
        "section": "THE HOOK",
        "visual_cue": "Brief description for editor", 
        "voiceover": "Script lines...",
        "image_prompt": "Cinematic wide shot of..., 35mm, 8k, --ar 16:9",
        "video_prompts": [
          "Shot 1 (0-5s): [Camera Angle] [Subject Action] [Lighting]...",
          "Shot 2 (5-10s): ..."
        ]
      }
    ],
    "title_options": ["Title 1", "Title 2", "Title 3"],
    "keywords": ["tag1", "tag2"],
    "description": "..."
  }
  `;

  const userQuery = `Create a script for: "${topic}"`;

  try {
    return await callGeminiViaPuter(systemPrompt, userQuery);
  } catch (e) {
    console.error("Gemini Gen Error:", e);
    throw e;
  }
}

export async function fetchPuterUser() { return { username: 'Google Cloud User' }; }
export async function fetchPuterMonthlyUsage() { return { remaining: 1000000, monthUsageAllowance: 1000000 }; }

export async function generateImage(prompt: string) {
  try {
    console.log(`[Service] Generating image via Pollinations (Go-to Free Tier) for: "${prompt.substring(0, 50)}..."`);
    const encodedPrompt = encodeURIComponent(prompt);
    const seed = Math.floor(Math.random() * 1000);
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1280&height=720&nologo=true&seed=${seed}`;
    return url;
  } catch (err: any) {
    console.warn("[Service] Image Gen failed:", err);
    return null;
  }
}

// --- SPEECH GENERATION (Google) ---
export async function generateSpeech(text: string, voiceName: string = 'en-US-Journey-D', sceneContext: string = '') {
  try {
    if (API_KEY) {
      console.log("[Service] Using Direct Google TTS");
      const { generateTTSWithGoogle } = await import('./google_direct');
      const audioContent = await generateTTSWithGoogle(text, voiceName);
      const dataUrl = `data:audio/mp3;base64,${audioContent}`;
      // Save logic (bg)
      try {
        const timestamp = Date.now();
        const contextPrefix = sceneContext ? `${sceneContext}_` : '';
        const filename = `${contextPrefix}voice_${timestamp}.mp3`;
        await fetch('http://localhost:3001/save-audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename, audioData: dataUrl })
        });
      } catch (saveErr) { }
      return dataUrl;
    }
    throw new Error("No Google API Key found");
  } catch (err: any) {
    console.warn("[Service] Speech Gen Error:", err);
    return null;
  }
}

// --- THUMBNAIL GENERATOR ---
export async function generateThumbnail(topic: string, niche: string, _referenceUrl: string) {
  try {
    const directorContext = getDirectorContext();
    const systemPrompt = `You are a YouTube Thumbnail Expert.
      GOAL: Describe a HIGH-CTR Thumbnail for a video about "${topic}" in the "${niche}" niche.
      KNOWLEDGE BASE: ${directorContext}
      INSTRUCTIONS: OUTPUT ONLY the raw image prompt for an AI generator.`;
    const userQuery = `Create a thumbnail prompt for: ${topic}`;
    let thumbnailPrompt = "";
    const result = await callGeminiViaPuter(systemPrompt, userQuery);
    if (typeof result === 'string') thumbnailPrompt = result;
    else if (result.response) thumbnailPrompt = result.response;
    else if (result.thumbnail_prompt) thumbnailPrompt = result.thumbnail_prompt;
    else thumbnailPrompt = JSON.stringify(result);
    return await generateImage(thumbnailPrompt);
  } catch (e) {
    console.error("Thumbnail Gen Error:", e);
    return null;
  }
}

export function calculateUsagePercentage() { return 0; }

// --- PIPER TTS (Offline) & UTILS ---
let piperEngine: any = null;

// Helper: Fetch model conf from HuggingFace/Github if needed? 
// For now, we assume local files in public/ 

export async function generateSpeechWithPiper(text: string) {
  try {
    console.log("[Service] Initializing Piper Engine (Local)...");

    // Dynamic import
    // @ts-ignore
    const { PiperWebEngine, PhonemizeWebRuntime, OnnxWebRuntime } = await import('piper-tts-web');

    if (!piperEngine) {
      console.log("[Piper] Creating new engine instance with custom paths...");
      // We must match the paths set in vite.config.ts
      piperEngine = new PiperWebEngine({
        phonemizeRuntime: new PhonemizeWebRuntime({ basePath: '/piper/' }),
        onnxRuntime: new OnnxWebRuntime({ basePath: '/onnx/' })
      });
    }

    console.log(`[Piper] Synthesizing: "${text.substring(0, 20)}..."`);

    // This ID must match the filename in public/models/
    // If file is "en_US-lessac-medium.onnx", the ID is "en_US-lessac-medium" IF the library can find it.
    // However, the library usually fetches from a repo. 
    // If we want to use LOCAL models, we have to pass the blob or configure the voice provider.
    // For MVP simplicity, let's try the direct generate call which works if the model is standard OR 
    // we might need to "install" the model if strictly offline. 
    // NOTE: If this fails to find the voice, we will need to load the blob manually.
    // But first, let's solve the WASM error.

    const voiceId = 'en_US-lessac-medium';

    const result = await piperEngine.generate(text, voiceId, 0);

    // Result structure: { phonemeData, file: Blob, duration }
    if (result && result.file) {
      // The library returns a Blob directly in result.file
      console.log(`[Piper] Success! Duration: ${result.duration}ms`);
      return URL.createObjectURL(result.file);
    } else if (result && result.rawAudio) {
      const blob = new Blob([result.rawAudio], { type: 'audio/wav' });
      return URL.createObjectURL(blob);
    } else if (result && result.audio) {
      return URL.createObjectURL(result.audio);
    }

    console.warn("[Piper] No audio in result", result);
    return null;

  } catch (e) {
    console.error("Piper TTS Error:", e);
    return null;
  }
}

// --- PUTER VIDEO (Cloud) ---
// Configurable delay between requests to avoid rate limiting
const VIDEO_REQUEST_DELAY_MS = 3000; // 3 seconds between requests

export async function generateVideoWithPuter(
  prompt: string,
  model: string = 'sora-2',
  retries: number = 2
): Promise<string | null> {
  if (typeof (window as any).puter === 'undefined') {
    console.error("[Puter Video] Puter.js not loaded!");
    throw new Error("Puter.js not initialized. Please reload the page.");
  }

  // Clean prompt (remove shot markers, limit length)
  const cleanPrompt = prompt
    .replace(/\[.*?\]/g, '') // Remove [Shot X] markers
    .replace(/\(\d+[s\-]+\d*s?\)/g, '') // Remove (5-15s) timing markers
    .trim()
    .substring(0, 500); // Limit prompt length

  console.log(`[Puter Video] Generating (${model}, 16:9): ${cleanPrompt.substring(0, 60)}...`);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await (window as any).puter.ai.txt2vid(cleanPrompt, {
        model: model,
        aspect_ratio: '16:9', // Force landscape 16:9
        // duration: 5 // Some APIs support duration in seconds
      });

      // Handle various response formats
      if (res && res.success === false) {
        const errorMsg = res.error?.message || res.error?.code || 'Unknown API error';
        console.error(`[Puter Video] API Error (Attempt ${attempt}/${retries}): ${errorMsg}`);

        // Check for rate limit / budget errors
        if (errorMsg.includes('budget') || errorMsg.includes('limit') || errorMsg.includes('quota')) {
          throw new Error(`BUDGET_EXCEEDED: Puter free tier limit reached. Try again later or upgrade your account.`);
        }

        if (attempt < retries) {
          console.log(`[Puter Video] Retrying in ${VIDEO_REQUEST_DELAY_MS / 1000}s...`);
          await new Promise(r => setTimeout(r, VIDEO_REQUEST_DELAY_MS));
          continue;
        }
        throw new Error(errorMsg);
      }

      // Extract video URL from response
      let videoUrl: string | null = null;
      if (typeof res === 'string') {
        videoUrl = res;
      } else if (res?.src) {
        videoUrl = res.src;
      } else if (res?.url) {
        videoUrl = res.url;
      } else if (res?.outerHTML && res.src) {
        // Video element returned
        videoUrl = res.src;
      }

      if (videoUrl) {
        console.log(`[Puter Video] ✓ Success! Video URL obtained.`);
        return videoUrl;
      }

      console.warn("[Puter Video] Unexpected response format:", res);
      return null;

    } catch (err: any) {
      console.error(`[Puter Video] Error (Attempt ${attempt}/${retries}):`, err);

      // Don't retry budget errors
      if (err.message?.includes('BUDGET_EXCEEDED')) {
        throw err;
      }

      if (attempt < retries) {
        console.log(`[Puter Video] Retrying in ${VIDEO_REQUEST_DELAY_MS / 1000}s...`);
        await new Promise(r => setTimeout(r, VIDEO_REQUEST_DELAY_MS));
      } else {
        throw err;
      }
    }
  }

  return null;
}

// --- DYNAMIC VISUAL EXPANSION ---
export async function generateExtraVideoPrompts(
  niche: string,
  voiceoverContext: string,
  existingPrompts: string[],
  countNeeded: number
) {
  try {
    const directorContext = getDirectorContext();
    const strategy = getRetentionStrategy(niche);

    const systemPrompt = `You are an Expert Visual Director API.
    ROLE: Expand a video scene by generating ${countNeeded} NEW, UNIQUE, and CINEMATIC video prompts.
    CONTEXT: The voiceover is longer than expected, so we need more B-Roll shots to cover the audio.
    
    STYLE: ${strategy.structure_name}
    KNOWLEDGE BASE: ${directorContext}

    EXISTING SHOTS (Do NOT repeat these):
    ${existingPrompts.map((p, i) => `Shot ${i + 1}: ${p}`).join('\n')}

    VOICEOVER CONTEXT:
    "${voiceoverContext}"

    INSTRUCTIONS:
    1. Generate exactly ${countNeeded} NEW visual prompts.
    2. Must match the mood/style of the existing shots.
    3. Must be visually distinct (different angles, subjects, or details).
    4. Each prompt must be a standalone 40-60 word description.
    5. OUTPUT JSON ONLY: { "new_prompts": ["Prompt 1...", "Prompt 2..."] }
    `;

    const userQuery = `Generate ${countNeeded} new shots.`;

    const result = await callGeminiViaPuter(systemPrompt, userQuery);

    // Parse result
    let newPrompts: string[] = [];
    if (result && result.new_prompts && Array.isArray(result.new_prompts)) {
      newPrompts = result.new_prompts;
    } else if (Array.isArray(result)) {
      newPrompts = result;
    }

    console.log(`[Service] Generated ${newPrompts.length} extra shots.`);
    return newPrompts;

  } catch (e) {
    console.error("Extra Visuals Gen Error:", e);
    return ["Cinematic B-Roll Placeholder"]; // Fallback
  }
}

// --- JUST-IN-TIME (JIT) VISUAL GENERATION ---
export async function generateExactVisuals(
  niche: string,
  voiceoverContext: string,
  countNeeded: number
) {
  try {
    const directorContext = getDirectorContext();
    const strategy = getRetentionStrategy(niche);

    const systemPrompt = `You are an Expert Visual Director API.
    ROLE: Generate a perfectly paced visual script for a video.
    CONTEXT: We have the final voiceover and need exactly ${countNeeded} visuals to match the duration (5-7s each).
    
    STYLE: ${strategy.structure_name}
    KNOWLEDGE BASE: ${directorContext}

    VOICEOVER CONTEXT:
    "${voiceoverContext}"

    INSTRUCTIONS:
    1. Generate exactly ${countNeeded} CINEMATIC visual prompts.
    2. Start wide/establishing if it's the beginning, move to close-ups for emotion.
    3. Ensure flow and variety (don't repeat angles).
    4. Each prompt must be a standalone 40-60 word description.
    5. OUTPUT JSON ONLY: { "prompts": ["Shot 1...", "Shot 2..."] }
    `;

    const userQuery = `Create ${countNeeded} shots for this script section.`;

    const result = await callGeminiViaPuter(systemPrompt, userQuery);

    // Parse result
    let prompts: string[] = [];
    if (result && result.prompts && Array.isArray(result.prompts)) {
      prompts = result.prompts;
    } else if (Array.isArray(result)) {
      prompts = result;
    }

    console.log(`[Service] JIT Generated ${prompts.length} exact shots.`);
    return prompts;

  } catch (e) {
    console.error("JIT Visuals Gen Error:", e);
    return [];
  }
}

// --- CONSULTANT AGENT (Agent 3) ---
export async function consultWithUser(history: { role: string, content: string }[]) {
  try {
    const directorContext = getDirectorContext();
    const systemPrompt = `You are 'The Consultant', a world-class Video Producer & Creative Strategist.
    GOAL: Help the user clarify their video idea until you have enough info to generate a perfect script.
    
    CONTEXT:
    - The user wants to make a YouTube video but might verify details.
    - You need to extract:
      1. TOPIC (What is it about?)
      2. NICHE (Gaming, Tech, Documentary, History, etc.)
      3. LENGTH (Target word count OR "Manual Duration" in seconds)
      4. STYLE (Cinematic, Fast-paced, Scary, etc.)

    KNOWLEDGE BASE: ${directorContext}

    INSTRUCTIONS:
    1. Be brief, professional, and helpful. 
    2. Ask ONE clarifying question at a time if details are missing.
    3. If the user mentions "External Audio" or "I have a voiceover", ask for the duration in seconds.
    4. WHEN YOU HAVE ALL 4 ITEMS (Topic, Niche, Length, Style):
       - Respond with a special JSON block at the END of your message.
       - JSON Format: 
         \`\`\`json
         {
           "ready": true,
           "topic": "...",
           "niche": "...",
           "videoLength": "1500 Words" (OR "MANUAL: 60s"),
           "voiceStyle": "..."
         }
         \`\`\`
    5. If not ready, "ready": false.

    CURRENT HISTORY:
    ${history.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}
    `;

    const userQuery = `Reply to the user.`;
    const result = await callGeminiViaPuter(systemPrompt, userQuery);

    // Check if result contains JSON block
    let responseText = "";
    let extractedConfig = null;

    if (typeof result === 'string') {
      responseText = result;

      // Try 1: Markdown code block format ```json ... ```
      let jsonMatch = result.match(/```json\n([\s\S]*?)\n```/);

      // Try 2: Raw inline JSON object { ... } at the end of the message
      if (!jsonMatch) {
        // Match JSON object that starts with { "ready": and ends with }
        jsonMatch = result.match(/\{\s*"ready"\s*:\s*(true|false)[\s\S]*?\}/);
        if (jsonMatch) {
          // Wrap in array format for consistent handling
          jsonMatch = [jsonMatch[0], jsonMatch[0]];
        }
      }

      if (jsonMatch && jsonMatch[1]) {
        try {
          extractedConfig = JSON.parse(jsonMatch[1]);
          // Remove the JSON from the displayed message
          responseText = result.replace(jsonMatch[0], '').trim();
          console.log("[Consultant] Extracted config:", extractedConfig);
        } catch (e) {
          console.warn("Failed to parse Consultant JSON", e);
        }
      }
    } else {
      responseText = result.response || "I'm having trouble thinking. Can you repeat that?";
    }

    return { message: responseText, config: extractedConfig };


  } catch (e) {
    console.error("Consultant Agent Error:", e);
    return { message: "System Error: The Consultant is offline.", config: null };
  }
}

// --- POLLINATIONS (UNLIMITED) ---
export async function generateVideoWithPollinations(prompt: string) {
  // Pollinations.ai is free and unlimited for high-res images.
  // We use this as a robust fallback or primary "Unlimited" option.
  // We use the 'flux' model for realism or 'midjourney' style.
  const cleanPrompt = prompt.replace(/\[.*?\]/g, '').trim();
  const seed = Math.floor(Math.random() * 1000000);

  // URL Structure: https://pollinations.ai/p/{prompt}?width=1280&height=720&seed={seed}&model=flux
  // Note: We return this as a URL string. The frontend can treat it as an image asset 
  // OR we can wrap it in a pseudo-video object if needed.
  // For the "Video" flow, we'll return it, but the UI might need to handle it as an image 
  // that plays with a pan/zoom effect or just static.
  // Using 'flux' model for best quality.

  const url = `https://pollinations.ai/p/${encodeURIComponent(cleanPrompt)}?width=1280&height=720&seed=${seed}&model=flux&nologo=true`;

  console.log(`[Pollinations] Generated: ${url}`);
  return url;
}