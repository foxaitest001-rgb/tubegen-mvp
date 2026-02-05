
import { useState, useRef, useEffect } from 'react'
import { Sparkles } from 'lucide-react';
import { ConsultantChat } from './components/ConsultantChat'
import { generateNarrative } from './services/puter'

function App() {
  const [step, setStep] = useState<'input' | 'generating' | 'result'>('input')
  const [niche, setNiche] = useState('')
  const [topic, setTopic] = useState('')
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  // State for director logs
  const [directorLogs, setDirectorLogs] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null)

  // Remote Server State - Load from localStorage if available
  const [serverUrl, setServerUrl] = useState(() => {
    const saved = localStorage.getItem('foxtubeServerUrl');
    return saved || 'http://localhost:3001';
  });
  const [showServerConfig, setShowServerConfig] = useState(false);

  // Save serverUrl to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('foxtubeServerUrl', serverUrl);
  }, [serverUrl]);

  // Consultant Handler
  const handleApplyConfig = (config: any) => {
    if (config.topic) setTopic(config.topic);
    if (config.niche) setNiche(config.niche);
    console.log("Config Applied:", config);
  };

  const handleStartPipeline = async (config: any) => {
    // Log helper
    const addLog = (msg: string) => {
      console.log(msg);
      setDirectorLogs(prev => [...prev, msg]);
    };

    // STEP 0: Clear old logs and cancel any running job
    setDirectorLogs(["[Pipeline] 🔄 Clearing previous session..."]);

    try {
      await fetch(`${serverUrl}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' })
      });
      addLog("[Pipeline] ✅ Previous job canceled (if any).");
    } catch (e) {
      console.warn("Could not cancel previous job:", e);
    }

    addLog("[Pipeline] 🚀 Starting FULL auto-generation with config: " + JSON.stringify(config));
    addLog(`[Pipeline] 🔌 Server: ${serverUrl}`);
    setStep('generating');
    try {
      // Step 1: Generate Script
      addLog("[Pipeline] 📝 Generating Script with Gemini...");
      const scriptResult = await generateNarrative(
        config.topic || topic,
        config.niche || niche,
        '',
        config.videoLength || '5-7 minutes',
        config.voiceStyle || 'Conversational',
        config.visualStyle || 'Cinematic',
        config.aspectRatio || '16:9',
        config.platform || 'YouTube',
        config.mood || 'Cinematic'
      );

      if (!scriptResult || !scriptResult.structure) throw new Error("Script generation failed");
      addLog(`[Pipeline] ✅ Script generated! Scenes: ${scriptResult.structure.length}`);

      // Step 2: Generate Voiceovers
      addLog("[Pipeline] 🎙️ Generating Voiceovers...");
      const { generateSpeechWithPiper, generateVideoWithPuter, generateVideoWithPollinations } = await import('./services/puter');

      // Hook Voiceover
      if (scriptResult.hook) {
        try {
          const hookUrl = await generateSpeechWithPiper(scriptResult.hook);
          if (hookUrl) {
            scriptResult.hookAudioUrl = hookUrl;
            addLog("[Pipeline] Hook voiceover created.");
          }
        } catch (e) { console.warn("Hook voiceover failed", e); }
      }

      // Scene Voiceovers
      for (let i = 0; i < scriptResult.structure.length; i++) {
        const scene = scriptResult.structure[i];
        if (scene.voiceover) {
          try {
            const url = await generateSpeechWithPiper(scene.voiceover);
            if (url) {
              scene.audioUrl = url;
              const words = scene.voiceover.split(' ').length;
              scene.duration = Math.ceil(words / 2.5);
              addLog(`[Pipeline] Scene ${i + 1}/${scriptResult.structure.length}: Voiceover ready (${scene.duration}s)`);
            }
          } catch (e) {
            console.warn("Scene voiceover failed", e);
            addLog(`[Pipeline] Scene ${i + 1}: Voiceover failed.`);
          }
        }
      }
      addLog("[Pipeline] ✅ Voiceovers complete.");

      // Helper: Blob to Base64
      const blobToBase64 = (blob: Blob): Promise<string> => {
        return new Promise((resolve, _) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      };

      // Step 3: Upload Audio to Server (Required for stitching/project structure)
      addLog(`[Pipeline] 📤 Uploading assets to Director Server (${serverUrl})...`);
      const projectName = `project_${Date.now()}`; // Create a unique ID for this run

      // Upload Hook Audio
      if (scriptResult.hookAudioUrl) {
        try {
          const resp = await fetch(scriptResult.hookAudioUrl);
          const blob = await resp.blob();
          const base64 = await blobToBase64(blob);
          await fetch(`${serverUrl}/save-audio`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: 'hook_audio.wav',
              audioData: base64,
              projectName: projectName
            })
          });
          addLog("[Pipeline] ✓ Hook audio uploaded.");
        } catch (e) { console.warn("Hook upload failed", e); }
      }

      // Upload Scene Audio
      for (let i = 0; i < scriptResult.structure.length; i++) {
        const scene = scriptResult.structure[i];
        if (scene.audioUrl) {
          try {
            const resp = await fetch(scene.audioUrl);
            const blob = await resp.blob();
            const base64 = await blobToBase64(blob);
            await fetch(`${serverUrl}/save-audio`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                filename: `scene_${i + 1}_audio.wav`,
                audioData: base64,
                projectName: projectName
              })
            });
          } catch (e) {
            console.warn(`Scene ${i + 1} audio upload failed`, e);
          }
        }
      }
      addLog("[Pipeline] ✅ Assets synchronized.");

      // Step 4: Trigger Server-Side Director (Meta AI + FFmpeg)
      addLog("[Pipeline] 🎬 Starting Director (Meta.ai) on Server...");

      // Attach the project name and ALL config parameters so server uses the correct settings
      scriptResult.title = projectName;
      scriptResult.visualStyle = config.visualStyle || 'Cinematic';
      scriptResult.aspectRatio = config.aspectRatio || '16:9';
      scriptResult.platform = config.platform || 'YouTube';
      scriptResult.mood = config.mood || 'Cinematic';

      await fetch(`${serverUrl}/generate-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptData: scriptResult })
      });

      addLog("[Pipeline] 🚀 Handed off to Director Agent! Check Remote Logs below...");
      if (serverUrl.includes('trycloudflare')) {
        addLog("[Pipeline] (Remote RDP Active - Please wait for tunnel latency)");
      }

      // We stay in 'generating' state to view the SSE logs from the server
      // The server will signal completion via logs/events

      setResult(scriptResult);
      setStep('result');
    } catch (e: any) {
      setError(e.message);
      setStep('input');
    }
  };

  useEffect(() => {
    // Scroll to bottom of logs
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [directorLogs]);

  // Cancel Director job when page closes/refreshes
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Send cancel request (fire-and-forget, uses navigator.sendBeacon for reliability)
      const payload = JSON.stringify({ action: 'cancel' });
      navigator.sendBeacon(`${serverUrl}/control`, payload);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [serverUrl]);

  useEffect(() => {
    // Subscribe to Director Events with Retry Logic (Silent when server offline)
    let evtSource: EventSource | null = null;
    let retryTimeout: any;
    let hasLoggedError = false;

    const connect = () => {
      // Use the configured server URL
      evtSource = new EventSource(`${serverUrl}/events`);

      evtSource.onopen = () => {
        hasLoggedError = false;
        console.log(`[Director] ✅ Connected to Director Logs at ${serverUrl}`);
        setDirectorLogs(prev => [...prev, `--- Connected to ${serverUrl} ---`]);
      };

      evtSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        // Handle different event types
        if (data.type === 'completed') {
          // SERVER FINISHED - Trigger auto-download of final video
          console.log("[Director] 🎉 Production complete! Files:", data.files);
          setDirectorLogs(prev => [...prev, `🎉 ${data.message}`]);
          setDirectorLogs(prev => [...prev, `📦 ${data.files?.length || 0} files available.`]);

          // Find and download final_video.mp4
          const finalVideo = data.files?.find((f: any) => f.isFinal || f.name === 'final_video.mp4');
          if (finalVideo) {
            setDirectorLogs(prev => [...prev, `⬇️ Downloading final_video.mp4 (${(finalVideo.size / (1024 * 1024)).toFixed(2)}MB)...`]);

            // Trigger browser download
            const downloadUrl = `${serverUrl}${finalVideo.path}`;
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = 'final_video.mp4';
            link.target = '_blank';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            setDirectorLogs(prev => [...prev, `✅ Download started! Check your browser downloads.`]);
          } else {
            setDirectorLogs(prev => [...prev, `⚠️ Final video not found in file list.`]);
          }

          // Move to result step
          setStep('result');

        } else if (data.type === 'log' || data.message) {
          // Regular log message
          setDirectorLogs(prev => [...prev, data.message]);
        }
      };

      evtSource.onerror = () => {
        if (!hasLoggedError) {
          console.log(`[Director] ⚠️ Server not reachable at ${serverUrl}. Retrying...`);
          hasLoggedError = true;
        }
        if (evtSource) evtSource.close();
        retryTimeout = setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      if (evtSource) evtSource.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [serverUrl]); // Re-connect when URL changes

  return (
    <div className="min-h-screen bg-black text-gray-100 font-sans selection:bg-purple-500/30">
      {/* Header */}
      <header className="fixed top-0 w-full border-b border-white/10 bg-black/50 backdrop-blur-md z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-purple-600 to-blue-600 rounded-lg flex items-center justify-center font-bold text-white">
              F
            </div>
            <span className="font-bold text-xl tracking-tight">FoxTubeGen v2.4</span>
            <span className="text-[10px] bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded-full border border-purple-500/20">
              CHAT ONLY MODE
            </span>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowServerConfig(!showServerConfig)}
              className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg border border-white/10 transition-colors flex items-center gap-2"
            >
              <span className={`w-2 h-2 rounded-full ${directorLogs.length > 0 && directorLogs[directorLogs.length - 1].includes('Connected') ? 'bg-green-500' : 'bg-red-500'}`}></span>
              {serverUrl.includes('localhost') ? 'Local Server' : 'Remote RDP'}
            </button>
          </div>
        </div>

        {/* Server Config Dropdown */}
        {showServerConfig && (
          <div className="absolute top-16 right-6 w-96 bg-gray-900 border border-white/10 rounded-xl p-4 shadow-2xl animate-in slide-in-from-top-2">
            <label className="block text-xs font-mono text-gray-400 mb-2">Director Server URL</label>
            <input
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              className="w-full bg-black border border-white/10 rounded px-3 py-2 text-sm focus:border-purple-500 outline-none font-mono text-green-400"
              placeholder="http://localhost:3001"
            />
            <p className="text-[10px] text-gray-500 mt-2">
              Paste Cloudflare Tunnel URL here for Remote RDP.<br />
              Default: <code>http://localhost:3001</code>
            </p>
          </div>
        )}
      </header>

      <main className="pt-24 pb-32 min-h-screen">
        {/* STEP 1: CONSULTANT UI */}
        {
          step === 'input' && (
            <div className="max-w-4xl mx-auto px-6 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">

              {/* Hero Section */}
              <div className="text-center space-y-4 py-8">
                <h1 className="text-5xl md:text-7xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white via-gray-200 to-gray-500 tracking-tight">
                  FoxTubeGen v2.4
                </h1>
                <p className="text-lg text-gray-400 max-w-2xl mx-auto">
                  AI-Powered Video Consultant. Chat below to plan your content.
                </p>
              </div>

              {/* Error Banner (Fix for unused var) */}
              {error && (
                <div className="bg-red-900/50 border border-red-500/50 text-red-200 px-4 py-3 rounded-xl max-w-2xl mx-auto backdrop-blur-sm animate-in fade-in slide-in-from-top-2">
                  <p className="flex items-center justify-center gap-2">
                    <span className="font-bold">⚠️ Error:</span> {error}
                  </p>
                </div>
              )}

              {/* Consultant-First UI (Simplified) */}
              <div className="text-center space-y-8 py-10">
                <div className="bg-purple-900/20 border border-purple-500/30 p-8 rounded-2xl backdrop-blur-sm max-w-2xl mx-auto">
                  <Sparkles className="w-12 h-12 text-purple-400 mx-auto mb-4" />
                  <h2 className="text-2xl font-bold text-white mb-2">FoxTubeGen v2.4 Consultant</h2>
                  <p className="text-gray-300 mb-6">
                    Chat with the AI to plan your video.
                  </p>

                  {/* Progress Monitor */}
                  <div className="bg-black/40 p-4 rounded-lg border border-white/5 text-left font-mono text-xs text-green-400 h-32 overflow-y-auto">
                    <div className="opacity-50 mb-2"># System Ready. Waiting for Consultant instructions...</div>
                    {directorLogs.map((log, i) => (
                      <div key={i}>{log}</div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Hidden state for internal logic */}
              <div className="hidden">
                <input value={niche} onChange={(e) => setNiche(e.target.value)} />
                <input value={topic} onChange={(e) => setTopic(e.target.value)} />
              </div>
            </div>
          )
        }

        {/* STEP 2: GENERATING VIEW (Live Logs Only) */}
        {
          step === 'generating' && (
            <div className="text-center space-y-8 py-10 animate-in fade-in duration-500">

              {/* Status Header */}
              <div className="space-y-2">
                <div className="relative w-20 h-20 mx-auto mb-6">
                  <div className="absolute inset-0 border-t-4 border-purple-500 rounded-full animate-spin"></div>
                  <div className="absolute inset-2 border-t-4 border-pink-500 rounded-full animate-spin animation-delay-150"></div>
                </div>
                <h2 className="text-2xl font-bold text-white">Production in Progress...</h2>
                <p className="text-gray-400">Orchestrating AI Agents for your video.</p>
              </div>

              {/* VISIBLE LOGSS */}
              <div className="mt-8 p-6 bg-black border border-green-500/30 rounded-xl shadow-2xl relative overflow-hidden text-left max-w-4xl mx-auto">
                <h3 className="text-green-400 font-mono text-sm mb-4 flex items-center gap-2">
                  <span className="animate-pulse">●</span> DIRECTOR TERMINAL
                </h3>
                <div className="h-96 overflow-y-auto font-mono text-xs text-green-300/80 space-y-1 p-2 bg-black/50 rounded border border-white/5" id="director-logs-gen">
                  <div className="border-l-2 border-green-500/20 pl-2 opacity-50">Initializing Consultant...</div>
                  <div className="border-l-2 border-green-500/20 pl-2 opacity-50">Analyzing Request...</div>
                  {directorLogs.map((log, i) => (
                    <div key={i} className="border-l-2 border-green-500/20 pl-2">{log}</div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </div>
            </div>
          )
        }

        {/* STEP 3: RESULT VIEW (JSON Only) */}
        {
          step === 'result' && (
            <div className="max-w-4xl mx-auto px-6 py-10 animate-in fade-in duration-500">
              <div className="bg-gray-900 border border-white/10 p-6 rounded-2xl">
                <h2 className="text-2xl font-bold text-white mb-4">Script Generated</h2>
                <div className="bg-black p-4 rounded-xl border border-white/5 font-mono text-xs h-96 overflow-y-auto text-gray-300">
                  {JSON.stringify(result, null, 2)}
                </div>
                <button
                  onClick={() => setStep('input')}
                  className="mt-6 w-full py-4 bg-white text-black font-bold rounded-xl hover:bg-gray-200 transition-all"
                >
                  Start New Chat
                </button>
              </div>
            </div>
          )
        }
      </main>

      <footer className="text-center py-6 text-slate-600 text-sm">
        <p>FoxTubeGen v2.4 • Chat-Only Mode</p>
      </footer>
      <ConsultantChat onApplyConfig={handleApplyConfig} onStartPipeline={handleStartPipeline} />
    </div>
  );
}

export default App;
