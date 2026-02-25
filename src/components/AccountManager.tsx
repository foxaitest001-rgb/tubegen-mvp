import { useState, useEffect } from 'react';

interface ServiceAccount {
    loaded: boolean;
    verified: boolean;
    verifiedAt: string | null;
    loadedAt: string | null;
    stats: {
        count: number;
        totalSize: string;
        keyCookies: { name: string; size: string; domain: string }[];
        domains: string[];
    } | null;
}

interface AccountStatus {
    meta: ServiceAccount;
    grok: ServiceAccount;
}

interface Props {
    serverUrl: string;
}

const SERVICES = [
    { id: 'meta', name: 'Meta AI', icon: '🤖', url: 'meta.ai', ext: 'Cookie-Editor' },
    { id: 'grok', name: 'Grok', icon: '⚡', url: 'grok.com', ext: 'Cookie-Editor' }
];

export function AccountManager({ serverUrl }: Props) {
    const [status, setStatus] = useState<AccountStatus | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [cookieInputs, setCookieInputs] = useState<Record<string, string>>({ meta: '', grok: '' });
    const [loading, setLoading] = useState<Record<string, boolean>>({ meta: false, grok: false });
    const [messages, setMessages] = useState<Record<string, string>>({ meta: '', grok: '' });

    // Fetch status on mount
    useEffect(() => {
        fetchStatus();
    }, [serverUrl]);

    const fetchStatus = async () => {
        try {
            const res = await fetch(`${serverUrl}/accounts/status`);
            const data = await res.json();
            setStatus(data);
        } catch {
            console.warn('Could not fetch account status');
        }
    };

    const handleLoad = async (service: string) => {
        const raw = cookieInputs[service];
        if (!raw.trim()) {
            setMessages(m => ({ ...m, [service]: '⚠️ Paste cookie JSON first' }));
            return;
        }

        setLoading(l => ({ ...l, [service]: true }));
        setMessages(m => ({ ...m, [service]: '⏳ Loading session...' }));

        try {
            const res = await fetch(`${serverUrl}/accounts/${service}/load`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cookies: raw })
            });
            const data = await res.json();

            if (data.success) {
                setMessages(m => ({ ...m, [service]: `✅ Loaded ${data.stats.count} cookies (${data.stats.totalSize})` }));
                setCookieInputs(c => ({ ...c, [service]: '' }));
                fetchStatus();
            } else {
                setMessages(m => ({ ...m, [service]: `❌ ${data.error}` }));
            }
        } catch (err: any) {
            setMessages(m => ({ ...m, [service]: `❌ ${err.message}` }));
        }
        setLoading(l => ({ ...l, [service]: false }));
    };

    const handleVerify = async (service: string) => {
        setLoading(l => ({ ...l, [service]: true }));
        setMessages(m => ({ ...m, [service]: '⏳ Verifying... (browser will open briefly)' }));

        try {
            const res = await fetch(`${serverUrl}/accounts/${service}/verify`, { method: 'POST' });
            const data = await res.json();

            if (data.verified) {
                setMessages(m => ({ ...m, [service]: '✅ Verified — ready to generate!' }));
            } else if (data.success && !data.verified) {
                setMessages(m => ({ ...m, [service]: `⚠️ ${data.message || 'Not logged in. Re-export cookies.'}` }));
            } else {
                setMessages(m => ({ ...m, [service]: `❌ ${data.error}` }));
            }
            fetchStatus();
        } catch (err: any) {
            setMessages(m => ({ ...m, [service]: `❌ ${err.message}` }));
        }
        setLoading(l => ({ ...l, [service]: false }));
    };

    const handleRemove = async (service: string) => {
        try {
            await fetch(`${serverUrl}/accounts/${service}/remove`, { method: 'DELETE' });
            setMessages(m => ({ ...m, [service]: '🗑️ Session removed' }));
            fetchStatus();
        } catch { /* ignore */ }
    };

    const getStatusBadge = (svc: ServiceAccount | undefined) => {
        if (!svc || !svc.loaded) return <span className="ftg-account-badge ftg-badge-empty">○ Not Set</span>;
        if (svc.verified) return <span className="ftg-account-badge ftg-badge-verified">✓ Verified</span>;
        return <span className="ftg-account-badge ftg-badge-loaded">● Loaded</span>;
    };

    // Count verified services
    const verifiedCount = status
        ? Object.values(status).filter(s => s.verified).length
        : 0;
    const loadedCount = status
        ? Object.values(status).filter(s => s.loaded).length
        : 0;

    return (
        <div className="ftg-accounts">
            <button className="ftg-accounts-toggle" onClick={() => setExpanded(!expanded)}>
                <span className="ftg-accounts-toggle-left">
                    <span className="ftg-accounts-icon">🔐</span>
                    <span>Accounts</span>
                    {loadedCount > 0 && (
                        <span className="ftg-accounts-count">
                            {verifiedCount}/{SERVICES.length} verified
                        </span>
                    )}
                </span>
                <span className={`ftg-chevron ${expanded ? 'ftg-chevron--open' : ''}`}>▸</span>
            </button>

            {expanded && (
                <div className="ftg-accounts-panel">
                    {/* Instructions */}
                    <div className="ftg-accounts-guide">
                        <p className="ftg-guide-title">How to get your session cookies:</p>
                        <ol className="ftg-guide-steps">
                            <li>Install <strong>Cookie-Editor</strong> extension in your browser</li>
                            <li>Open the website and log in with your account</li>
                            <li>Click Cookie-Editor icon → <strong>Export</strong> → <strong>Export as JSON</strong></li>
                            <li>Paste the JSON below and click <strong>Load Session</strong></li>
                        </ol>
                    </div>

                    {/* Service panels */}
                    {SERVICES.map(svc => {
                        const svcStatus = status?.[svc.id as keyof AccountStatus];

                        return (
                            <div key={svc.id} className="ftg-account-service">
                                <div className="ftg-account-header">
                                    <span className="ftg-account-name">
                                        <span>{svc.icon}</span>
                                        <span>{svc.name}</span>
                                    </span>
                                    {getStatusBadge(svcStatus)}
                                </div>

                                {/* Status info */}
                                {svcStatus?.loaded && svcStatus.stats && (
                                    <div className="ftg-account-stats">
                                        <span>🍪 {svcStatus.stats.count} cookies</span>
                                        <span>📦 {svcStatus.stats.totalSize}</span>
                                        {svcStatus.stats.domains.slice(0, 3).map(d => (
                                            <span key={d} className="ftg-account-domain">{d}</span>
                                        ))}
                                    </div>
                                )}

                                {/* Cookie input textarea */}
                                {!svcStatus?.loaded && (
                                    <textarea
                                        className="ftg-account-textarea"
                                        placeholder={`Paste cookie JSON from ${svc.url} here...`}
                                        value={cookieInputs[svc.id]}
                                        onChange={e => setCookieInputs(c => ({ ...c, [svc.id]: e.target.value }))}
                                        rows={3}
                                    />
                                )}

                                {/* Action buttons */}
                                <div className="ftg-account-actions">
                                    {!svcStatus?.loaded ? (
                                        <button
                                            className="ftg-account-btn ftg-account-btn--load"
                                            onClick={() => handleLoad(svc.id)}
                                            disabled={loading[svc.id]}
                                        >
                                            {loading[svc.id] ? '⏳' : '📥'} Load Session
                                        </button>
                                    ) : (
                                        <>
                                            <button
                                                className="ftg-account-btn ftg-account-btn--verify"
                                                onClick={() => handleVerify(svc.id)}
                                                disabled={loading[svc.id]}
                                            >
                                                {loading[svc.id] ? '⏳' : '✓'} Verify
                                            </button>
                                            <button
                                                className="ftg-account-btn ftg-account-btn--remove"
                                                onClick={() => handleRemove(svc.id)}
                                            >
                                                🗑️
                                            </button>
                                        </>
                                    )}
                                </div>

                                {/* Status message */}
                                {messages[svc.id] && (
                                    <div className={`ftg-account-msg ${messages[svc.id].includes('✅') ? 'ftg-msg--ok' :
                                            messages[svc.id].includes('❌') ? 'ftg-msg--err' :
                                                messages[svc.id].includes('⚠️') ? 'ftg-msg--warn' : ''
                                        }`}>
                                        {messages[svc.id]}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
