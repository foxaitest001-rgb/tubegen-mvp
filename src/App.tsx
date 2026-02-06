
import { useState, useRef, useEffect } from 'react'
import { Settings, Zap, Download } from 'lucide-react';
import { ConsultantChat } from './components/ConsultantChat'
import { generateNarrative } from './services/puter'

function App() {
  // const [step, setStep] = useState<'input' | 'generating' | 'result'>('input') // Unused
  // const [result, setResult] = useState<any>(null) // Unused
  const [niche, setNiche] = useState('')
  const [topic, setTopic] = useState('')
  const [error, setError] = useState<string | null>(null)

  // State for director logs
  const [directorLogs, setDirectorLogs] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null)

  // Final video download state
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // Remote Server State
  const [serverUrl, setServerUrl] = useState(() => {
    const saved = localStorage.getItem('foxtubeServerUrl');
    return saved || 'http://localhost:3001';
  });
  const [showServerConfig, setShowServerConfig] = useState(false);

  // State for result
  const [projectFolder, setProjectFolder] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('foxtubeServerUrl', serverUrl);
  }, [serverUrl]);

  // Parse Logs for Download URL
  useEffect(() => {
    if (!directorLogs.length) return;
    const lastLog = directorLogs[directorLogs.length - 1];

    // Capture Project Folder Name (Robust)
    // Log format: [SCENE 0] [PROJECT] Output folder: 2026-02-06_...
    if (lastLog.includes('Output folder:')) {
      const parts = lastLog.split('Output folder:');
      if (parts.length > 1) {
        const folder = parts[1].trim();
        console.log("Captured Project Folder:", folder);
        setProjectFolder(folder);
      }
    }

    // Also scan history if not set (in case we missed it)
    if (!projectFolder) {
      const folderLog = directorLogs.find(l => l.includes('Output folder:'));
      if (folderLog) {
        const parts = folderLog.split('Output folder:');
        if (parts.length > 1) {
          setProjectFolder(parts[1].trim());
        }
      }
    }

    // Capture Completion
    // Log format: [SCENE 0] [ASSEMBLE] ✅ Final video created: final_video.mp4
    if (lastLog.includes('Final video created') && projectFolder) {
      // Construct URL
      const dlUrl = `${serverUrl}/output/${projectFolder}/final_video.mp4`;
      console.log("Download URL Available:", dlUrl);
      setFinalVideoUrl(dlUrl);
    }
  }, [directorLogs, projectFolder, serverUrl]);

  const handleApplyConfig = (config: any) => {
    if (config.topic) setTopic(config.topic);
    if (config.niche) setNiche(config.niche);
    console.log("Config Applied:", config);
  };

  const handleStartPipeline = async (config: any) => {
    const addLog = (msg: string) => {
      console.log(msg);
      setDirectorLogs(prev => [...prev, msg]);
    };

    setDirectorLogs(["[Pipeline] 🔄 Initializing production pipeline..."]);

    try {
      await fetch(`${serverUrl}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' })
      });
      addLog("[Pipeline] ✅ Ready for new production.");
    } catch (e) {
      console.warn("Could not cancel previous job:", e);
    }

    addLog("[Pipeline] 🚀 Starting auto-generation...");
    addLog(`[Pipeline] 📡 Server: ${serverUrl}`);
    addLog("[Pipeline] 🚀 Starting auto-generation...");
    addLog(`[Pipeline] 📡 Server: ${serverUrl}`);

    try {
      addLog("[Pipeline] 📝 Generating Script...");
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
      addLog(`[Pipeline] ✅ Script ready! ${scriptResult.structure.length} scenes`);

      // Start Video Job First (to create project folder)
      addLog("[Pipeline] 🎬 Initializing Director Job...");
      const rawName = scriptResult.title_options?.[0] || config.topic || 'video_project';
      // Sanitize project name to be URL-safe (remove apostrophes, spaces, etc.)
      const projectName = rawName.replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase();

      scriptResult.title = projectName;
      scriptResult.visualStyle = config.visualStyle || 'Cinematic';
      scriptResult.aspectRatio = config.aspectRatio || '16:9';
      scriptResult.platform = config.platform || 'YouTube';
      scriptResult.mood = config.mood || 'Cinematic';

      // 1. Kickoff Job (Creates Project Folder & Starts Video Gen)
      await fetch(`${serverUrl}/generate-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptData: scriptResult })
      });
      addLog("[Pipeline] ✅ Director Job Started.");

      // 2. Request Server-Side Audio Generation
      addLog("[Pipeline] 🎙️ Requesting Server-Side Audio Generation...");
      try {
        const { generateAudioOnServer } = await import('./services/puter');

        for (let i = 0; i < scriptResult.structure.length; i++) {
          const scene = scriptResult.structure[i];
          if (scene.voiceover) {
            try {
              const success = await generateAudioOnServer(scene.voiceover, config.voiceStyle, i + 1, serverUrl);
              if (success) {
                addLog(`[Pipeline] ✓ Audio generated for Scene ${i + 1}`);
              } else {
                addLog(`[Pipeline] ⚠ Audio Start Failed for Scene ${i + 1}`);
              }
            } catch (e) {
              addLog(`[Pipeline] ⚠ Audio Request Error Scene ${i + 1}`);
            }
          }
        }
      } catch (e) {
        addLog("[Pipeline] ⚠ Audio Generation Module Failed");
      }

      addLog("[Pipeline] ✅ All assets requested. Director is working...");

      setDirectorLogs(prev => [...prev, "[Pipeline] 🚀 Director is working! Watch logs below..."]);
    } catch (e: any) {
      setError(e.message);
    }
  };


  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [directorLogs]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      navigator.sendBeacon(`${serverUrl}/control`, JSON.stringify({ action: 'cancel' }));
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [serverUrl]);

  useEffect(() => {
    let evtSource: EventSource | null = null;
    let retryTimeout: any;

    const connect = () => {
      evtSource = new EventSource(`${serverUrl}/events`);
      evtSource.onopen = () => {
        setDirectorLogs(prev => [...prev, `--- Connected to Director ---`]);
      };
      evtSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'completed') {
          setDirectorLogs(prev => [...prev, `🎉 ${data.message}`]);
          const finalVideo = data.files?.find((f: any) => f.isFinal || f.name === 'final_video.mp4');
          if (finalVideo) {
            const downloadUrl = `${serverUrl}${finalVideo.path}`;
            setFinalVideoUrl(downloadUrl);
            setDirectorLogs(prev => [...prev, `⬇️ Auto-downloading from: ${downloadUrl}`]);
            handleDownloadVideo(downloadUrl);
          }
        } else if (data.type === 'log') {
          setDirectorLogs(prev => [...prev, data.message]);
        }
      };
      evtSource.onerror = () => {
        evtSource?.close();
        retryTimeout = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => { evtSource?.close(); clearTimeout(retryTimeout); };
  }, [serverUrl]);

  // Manual Download Handler
  const handleDownloadVideo = (url: string) => {
    setIsDownloading(true);
    setDirectorLogs(prev => [...prev, `⬇️ Downloading video...`]);

    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error("Download failed");
        return res.blob();
      })
      .then(blob => {
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = 'final_video.mp4';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(blobUrl);
        setIsDownloading(false);
        setDirectorLogs(prev => [...prev, `✅ Download saved to disk.`]);
      })
      .catch(err => {
        console.error(err);
        setIsDownloading(false);
        setDirectorLogs(prev => [...prev, `❌ Download failed. Opening in new tab...`]);
        window.open(url, '_blank');
      });
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col">
      {/* Gradient Background */}
      <div className="fixed inset-0 bg-gradient-to-br from-purple-900/20 via-transparent to-cyan-900/20 pointer-events-none" />
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-purple-500/10 blur-[120px] rounded-full pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 px-6 py-4 flex justify-between items-center border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/30">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
              FoxTubeGen
            </h1>
            <p className="text-xs text-gray-500">AI Video Production</p>
          </div>
        </div>
        <div className="flex gap-2">
          {/* Force show download if we have a project folder and success message, OR if finalVideoUrl is set */}
          {(finalVideoUrl || (projectFolder && directorLogs.some(l => l.includes('finished successfully')))) && (
            <button
              onClick={() => handleDownloadVideo(finalVideoUrl || `${serverUrl}/output/${projectFolder}/final_video.mp4`)}
              disabled={isDownloading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-green-500 hover:bg-green-400 text-black shadow-lg shadow-green-500/20 transition-all animate-pulse-slow"
            >
              <Download className={`w-4 h-4 ${isDownloading ? 'animate-bounce' : ''}`} />
              {isDownloading ? 'Downloading...' : 'Download Video'}
            </button>
          )}

          {/* Manual Download - Always Visible */}
          <button
            onClick={() => {
              const folder = prompt("Enter project folder name (from logs):", projectFolder || "2026-02-06_my_video");
              if (folder) {
                const url = `${serverUrl}/output/${folder}/final_video.mp4`;
                window.open(url, '_blank');
              }
            }}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition-all"
            title="Manually download by entering folder name"
          >
            <Download className="w-4 h-4" />
            Manual DL
          </button>

          <button
            onClick={() => setShowServerConfig(!showServerConfig)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all
            ${showServerConfig
                ? 'bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/50'
                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'}`}
          >
            <Settings className="w-4 h-4" />
            {serverUrl.includes('localhost') ? 'Local Mode' : 'Remote Mode'}
          </button>
        </div>
      </header >

      {/* Server Config */}
      {
        showServerConfig && (
          <div className="relative z-10 px-6 py-4 bg-black/40 border-b border-white/5 backdrop-blur-sm">
            <div className="max-w-2xl mx-auto">
              <label className="block text-sm font-medium text-gray-300 mb-2">Director Server URL</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="https://xxx.trycloudflare.com"
                  className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all"
                />
                <button
                  onClick={() => setShowServerConfig(false)}
                  className="px-6 py-3 bg-purple-500 hover:bg-purple-400 text-white font-medium rounded-xl transition-colors"
                >
                  Save
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                💡 Paste Cloudflare tunnel URL for RDP, or localhost:3001 for local testing
              </p>
            </div>
          </div>
        )
      }

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <ConsultantChat
            onApplyConfig={handleApplyConfig}
            onStartPipeline={handleStartPipeline}
          />
        </div>

        {/* Director Logs */}
        {directorLogs.length > 0 && (
          <div className="h-56 border-t border-white/5 bg-black/60 backdrop-blur-sm flex flex-col">
            <div className="px-4 py-3 border-b border-white/5 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-sm font-semibold text-white">Director Logs (v2.6 PATCHED)</span>
                <span className="text-xs text-gray-500">({directorLogs.length} entries)</span>
              </div>
              <button
                onClick={() => setDirectorLogs([])}
                className="text-xs px-3 py-1 bg-white/5 hover:bg-red-500/20 hover:text-red-400 text-gray-400 rounded-lg transition-colors"
              >
                Clear
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1">
              {directorLogs.map((log, i) => (
                <div
                  key={i}
                  className={`${log.includes('✅') || log.includes('🎉') ? 'text-green-400' :
                    log.includes('⚠') ? 'text-yellow-400' :
                      log.includes('❌') ? 'text-red-400' :
                        log.includes('🚀') || log.includes('🎬') ? 'text-purple-400' :
                          'text-gray-400'
                    }`}
                >
                  {log}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        )}
      </main>

      {/* Error Toast */}
      {
        error && (
          <div className="fixed bottom-6 right-6 z-50 bg-red-500/90 backdrop-blur text-white px-5 py-3 rounded-xl shadow-2xl shadow-red-500/20 flex items-center gap-3">
            <span className="text-sm">{error}</span>
            <button onClick={() => setError(null)} className="text-white/80 hover:text-white font-bold">×</button>
          </div>
        )
      }
    </div >
  )
}

export default App
