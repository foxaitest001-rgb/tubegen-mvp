
import { useState, useRef, useEffect } from 'react'
import './App.css'
import { Settings, Download, Zap, Film, Sparkles } from 'lucide-react';
import { ConsultantChat } from './components/ConsultantChat'
import { AccountManager } from './components/AccountManager'
import { generateNarrative } from './services/puter'

type VideoSource = 'meta' | 'grok';
type PipelineMode = 'quick' | 'pro';

// Channel archetypes from Knowledge Base
const CHANNEL_STYLES = [
  { id: '', name: 'Custom', niche: 'Your own style', icon: '✨' },
  { id: 'workflow_kurzgesagt', name: 'Kurzgesagt', niche: 'Science/Education', icon: '🔬' },
  { id: 'workflow_llama_arts', name: 'Llama Arts', niche: 'Horror/Animated', icon: '👻' },
  { id: 'workflow_nick_invests', name: 'Nick Invests', niche: 'Finance', icon: '💰' },
  { id: 'workflow_serious_history', name: 'Serious History', niche: 'Documentary', icon: '📜' },
  { id: 'workflow_infographics', name: 'Infographics Show', niche: 'Explainer', icon: '📊' },
  { id: 'workflow_zinny', name: 'Zinny Studio', niche: 'AI/Business', icon: '🤖' },
  { id: 'workflow_ai_politician', name: 'AI Politician', niche: 'Political Drama', icon: '🏛️' },
  { id: 'workflow_warren_buffet', name: 'Warren Buffet', niche: 'Investment', icon: '📈' },
];

function App() {
  const [niche, setNiche] = useState('')
  const [topic, setTopic] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [videoSource, setVideoSource] = useState<VideoSource>('meta')
  const [pipelineMode, setPipelineMode] = useState<PipelineMode>('pro')
  const [channelStyle, setChannelStyle] = useState('')

  const [directorLogs, setDirectorLogs] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null)

  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const [serverUrl, setServerUrl] = useState(() => {
    const saved = localStorage.getItem('foxtubeServerUrl');
    return saved || 'http://localhost:3001';
  });
  const [showServerConfig, setShowServerConfig] = useState(false);

  const [projectFolder, setProjectFolder] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('foxtubeServerUrl', serverUrl);
  }, [serverUrl]);

  useEffect(() => {
    if (!directorLogs.length) return;
    const lastLog = directorLogs[directorLogs.length - 1];

    if (lastLog.includes('Output folder:')) {
      const parts = lastLog.split('Output folder:');
      if (parts.length > 1) {
        const folder = parts[1].trim();
        setProjectFolder(folder);
      }
    }

    if (!projectFolder) {
      const folderLog = directorLogs.find(l => l.includes('Output folder:'));
      if (folderLog) {
        const parts = folderLog.split('Output folder:');
        if (parts.length > 1) setProjectFolder(parts[1].trim());
      }
    }

    if (lastLog.includes('Final video created') && projectFolder) {
      const dlUrl = `${serverUrl}/output/${projectFolder}/final_video.mp4`;
      setFinalVideoUrl(dlUrl);
    }
  }, [directorLogs, projectFolder, serverUrl]);

  const handleApplyConfig = (config: any) => {
    if (config.topic) setTopic(config.topic);
    if (config.niche) setNiche(config.niche);
    // Note: pipelineMode is NOT applied here — the user's Quick/Pro toggle takes priority
    if (config.channelStyle) setChannelStyle(config.channelStyle);
  };

  const handleStartPipeline = async (config: any) => {
    const addLog = (msg: string) => {
      console.log(msg);
      setDirectorLogs(prev => [...prev, msg]);
    };

    const mode = pipelineMode; // Always use the user's toggle, never the consultant's auto-detect
    const source = videoSource === 'grok' ? 'Grok' : 'Meta.ai';

    setDirectorLogs([`[Pipeline] 🔄 Initializing ${mode.toUpperCase()} mode (${source})...`]);

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

    const activeChannel = config.channelStyle || channelStyle;
    if (activeChannel) {
      const ch = CHANNEL_STYLES.find(c => c.id === activeChannel);
      addLog(`[Pipeline] 📺 Channel Style: ${ch?.name || activeChannel}`);
    }
    addLog(`[Pipeline] 🚀 Starting ${mode.toUpperCase()} via ${source}...`);
    addLog(`[Pipeline] 📡 Server: ${serverUrl}`);

    try {
      addLog("[Pipeline] 📝 Generating Script...");
      const scriptResult = await generateNarrative(
        config.topic || topic, config.niche || niche, '',
        config.videoLength || '5-7 minutes', config.voiceStyle || 'Conversational',
        config.visualStyle || 'Cinematic', config.aspectRatio || '16:9',
        config.platform || 'YouTube', config.mood || 'Cinematic'
      );

      if (!scriptResult || !scriptResult.structure) throw new Error("Script generation failed");
      addLog(`[Pipeline] ✅ Script ready! ${scriptResult.structure.length} scenes`);

      addLog("[Pipeline] 🎬 Initializing Director Job...");
      const rawName = scriptResult.title_options?.[0] || config.topic || 'video_project';
      const projectName = rawName.replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase();

      scriptResult.title = projectName;
      scriptResult.visualStyle = config.visualStyle || 'Cinematic';
      scriptResult.aspectRatio = config.aspectRatio || '16:9';
      scriptResult.platform = config.platform || 'YouTube';
      scriptResult.mood = config.mood || 'Cinematic';
      scriptResult.videoSource = videoSource;
      scriptResult.channelStyle = activeChannel || undefined;

      // Route to correct endpoint based on pipeline mode
      const endpoint = mode === 'pro' ? '/generate-pipeline-pro' : '/generate-video';
      addLog(`[Pipeline] 🔀 Routing to: ${endpoint}`);

      await fetch(`${serverUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptData: scriptResult })
      });
      addLog("[Pipeline] ✅ Director Job Started.");

      addLog("[Pipeline] 🎙️ Requesting Audio...");
      try {
        const { generateAudioOnServer } = await import('./services/puter');
        for (let i = 0; i < scriptResult.structure.length; i++) {
          const scene = scriptResult.structure[i];
          if (scene.voiceover) {
            try {
              const success = await generateAudioOnServer(scene.voiceover, config.voiceStyle, i + 1, serverUrl);
              addLog(success ? `[Pipeline] ✓ Audio Scene ${i + 1}` : `[Pipeline] ⚠ Audio Failed Scene ${i + 1}`);
            } catch (e) { addLog(`[Pipeline] ⚠ Audio Error Scene ${i + 1}`); }
          }
        }
      } catch (e) { addLog("[Pipeline] ⚠ Audio Module Failed"); }

      addLog("[Pipeline] ✅ All assets requested. Director working...");
      setDirectorLogs(prev => [...prev, "[Pipeline] 🚀 Director is working!"]);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [directorLogs]);

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
      evtSource.onopen = () => setDirectorLogs(prev => [...prev, `--- Connected to Director ---`]);
      evtSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'completed') {
          setDirectorLogs(prev => [...prev, `🎉 ${data.message}`]);
          const finalVideo = data.files?.find((f: any) => f.isFinal || f.name === 'final_video.mp4');
          if (finalVideo) {
            const downloadUrl = `${serverUrl}${finalVideo.path}`;
            setFinalVideoUrl(downloadUrl);
            setDirectorLogs(prev => [...prev, `⬇️ Auto-downloading: ${downloadUrl}`]);
            handleDownloadVideo(downloadUrl);
          }
        } else if (data.type === 'log') {
          setDirectorLogs(prev => [...prev, data.message]);
        }
      };
      evtSource.onerror = () => { evtSource?.close(); retryTimeout = setTimeout(connect, 3000); };
    };
    connect();
    return () => { evtSource?.close(); clearTimeout(retryTimeout); };
  }, [serverUrl]);

  const handleDownloadVideo = (url: string) => {
    setIsDownloading(true);
    setDirectorLogs(prev => [...prev, `⬇️ Downloading video...`]);
    fetch(url)
      .then(res => { if (!res.ok) throw new Error("Download failed"); return res.blob(); })
      .then(blob => {
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl; a.download = 'final_video.mp4';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        window.URL.revokeObjectURL(blobUrl);
        setIsDownloading(false);
        setDirectorLogs(prev => [...prev, `✅ Download saved.`]);
      })
      .catch(err => {
        console.error(err);
        setIsDownloading(false);
        setDirectorLogs(prev => [...prev, `❌ Download failed.`]);
        window.open(url, '_blank');
      });
  };

  const sourceLabel = videoSource === 'grok' ? 'Grok' : 'Meta.ai';
  const hasVideo = finalVideoUrl || (projectFolder && directorLogs.some(l => l.includes('finished successfully')));
  const activeChannelInfo = CHANNEL_STYLES.find(c => c.id === channelStyle);

  return (
    <div className="ftg-app">
      {/* Top bar: settings + download */}
      <div className="ftg-topbar">
        <div className="ftg-topbar-left">
          {hasVideo && (
            <button
              onClick={() => handleDownloadVideo(finalVideoUrl || `${serverUrl}/output/${projectFolder}/final_video.mp4`)}
              disabled={isDownloading}
              className="ftg-btn-dl"
            >
              <Download className="ftg-icon-sm" />
              {isDownloading ? 'Downloading...' : 'Download'}
            </button>
          )}
          <button
            onClick={() => {
              const folder = prompt("Enter project folder name:", projectFolder || "2026-02-06_my_video");
              if (folder) window.open(`${serverUrl}/output/${folder}/final_video.mp4`, '_blank');
            }}
            className="ftg-btn-ghost"
            title="Manual download"
          >
            <Download className="ftg-icon-sm" />
          </button>
        </div>
        <div className="ftg-topbar-right">
          <button
            onClick={() => setShowServerConfig(!showServerConfig)}
            className={`ftg-btn-ghost ${showServerConfig ? 'ftg-btn-ghost--active' : ''}`}
          >
            <Settings className="ftg-icon-sm" />
            <span>{serverUrl.includes('localhost') ? 'Local' : 'Remote'}</span>
          </button>
        </div>
      </div>

      {/* Server Config */}
      {showServerConfig && (
        <div className="ftg-config">
          <div className="ftg-config-inner">
            <label className="ftg-config-label">Director Server URL</label>
            <div className="ftg-config-row">
              <input
                type="text" value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://xxx.trycloudflare.com"
                className="ftg-input"
              />
              <button onClick={() => setShowServerConfig(false)} className="ftg-btn-primary">Save</button>
            </div>
            <p className="ftg-hint">💡 Paste Cloudflare tunnel URL for RDP, or localhost:3001 for local</p>
          </div>
        </div>
      )}

      {/* Center Content — Grok-style hero */}
      <div className="ftg-center">
        <div className="ftg-hero">
          {/* Logo */}
          <div className="ftg-logo">
            <div className="ftg-logo-bolt">
              <Zap />
            </div>
            <span className="ftg-logo-name">FoxTubeGen</span>
          </div>

          {/* Pipeline Mode Toggle */}
          <div className="ftg-mode-toggle">
            <button
              onClick={() => setPipelineMode('quick')}
              className={`ftg-mode-btn ${pipelineMode === 'quick' ? 'ftg-mode-btn--active' : ''}`}
            >
              <Zap className="ftg-icon-xs" />
              Quick
            </button>
            <button
              onClick={() => setPipelineMode('pro')}
              className={`ftg-mode-btn ${pipelineMode === 'pro' ? 'ftg-mode-btn--active ftg-mode-btn--pro' : ''}`}
            >
              <Film className="ftg-icon-xs" />
              Pro
            </button>
          </div>

          {/* Source Toggle */}
          <div className="ftg-source-toggle">
            <button
              onClick={() => setVideoSource('meta')}
              className={`ftg-toggle-btn ${videoSource === 'meta' ? 'ftg-toggle-btn--active' : ''}`}
            >
              Meta.ai
            </button>
            <button
              onClick={() => setVideoSource('grok')}
              className={`ftg-toggle-btn ${videoSource === 'grok' ? 'ftg-toggle-btn--active' : ''}`}
            >
              Grok
            </button>
          </div>

          {/* Channel Style Selector */}
          <div className="ftg-channel-selector">
            <div className="ftg-channel-label">
              <Sparkles className="ftg-icon-xs" />
              Channel Style
            </div>
            <div className="ftg-channel-grid">
              {CHANNEL_STYLES.map(ch => (
                <button
                  key={ch.id}
                  onClick={() => setChannelStyle(ch.id)}
                  className={`ftg-channel-btn ${channelStyle === ch.id ? 'ftg-channel-btn--active' : ''}`}
                  title={ch.niche}
                >
                  <span className="ftg-channel-icon">{ch.icon}</span>
                  <span className="ftg-channel-name">{ch.name}</span>
                </button>
              ))}
            </div>
            {activeChannelInfo && activeChannelInfo.id && (
              <p className="ftg-channel-desc">{activeChannelInfo.niche}</p>
            )}
          </div>
        </div>
      </div>

      {/* Account Session Manager */}
      <AccountManager serverUrl={serverUrl} />

      {/* Consultant Chat — inline, Grok-style */}
      <ConsultantChat
        onApplyConfig={handleApplyConfig}
        onStartPipeline={handleStartPipeline}
        videoSource={videoSource}
        channelStyle={channelStyle}
        serverUrl={serverUrl}
      />

      {/* Director Logs */}
      {directorLogs.length > 0 && (
        <div className="ftg-logs">
          <div className="ftg-logs-bar">
            <div className="ftg-logs-title">
              <span className="ftg-dot" />
              <span>Director • {sourceLabel} • {pipelineMode.toUpperCase()}</span>
              <span className="ftg-logs-count">{directorLogs.length}</span>
            </div>
            <button onClick={() => setDirectorLogs([])} className="ftg-btn-clear">Clear</button>
          </div>
          <div className="ftg-logs-scroll">
            {directorLogs.map((log, i) => (
              <div
                key={i}
                className={`ftg-log ${log.includes('✅') || log.includes('🎉') ? 'ftg-log--ok' :
                  log.includes('⚠') ? 'ftg-log--warn' :
                    log.includes('❌') ? 'ftg-log--err' :
                      log.includes('🚀') || log.includes('🎬') ? 'ftg-log--act' :
                        log.includes('📚') || log.includes('📺') ? 'ftg-log--knowledge' : ''
                  }`}
              >
                {log}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {/* Error Toast */}
      {error && (
        <div className="ftg-toast">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ftg-toast-x">×</button>
        </div>
      )}
    </div>
  )
}

export default App
