import { useState, useEffect } from 'react';
import { fetchPuterUser, fetchPuterMonthlyUsage, calculateUsagePercentage } from '../services/puter';
import UsageModal from './UsageModal';

// Simple Activity Icon
const ActivityIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
);

export function UsageBadge() {
    const [showModal, setShowModal] = useState(false);
    const [usage, setUsage] = useState<{ user: any; allowance: any } | null>(null);
    const [loading, setLoading] = useState(false);

    const refreshUsage = async () => {
        setLoading(true);
        const [user, allowance] = await Promise.all([
            fetchPuterUser(),
            fetchPuterMonthlyUsage()
        ]);
        setUsage({ user, allowance });
        setLoading(false);
    };

    useEffect(() => {
        refreshUsage();
        // Auto-refresh every 60s
        const interval = setInterval(refreshUsage, 60000);
        return () => clearInterval(interval);
    }, []);

    const pct = usage ? calculateUsagePercentage(usage.allowance) : null;

    return (
        <>
            <button
                onClick={() => { setShowModal(true); refreshUsage(); }}
                title="Puter.js API Usage"
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
            >
                <ActivityIcon />
                <span>
                    {import.meta.env.VITE_GOOGLE_API_KEY ? (
                        <span className="text-purple-600 font-bold text-xs">Gemini 3.0 Pro</span>
                    ) : (
                        pct !== null ? `${Math.round(pct)}%` : 'API'
                    )}
                </span>
            </button>

            {showModal && (
                <UsageModal
                    isOpen={showModal}
                    onClose={() => setShowModal(false)}
                    usage={usage}
                    onRefresh={refreshUsage}
                    loading={loading}
                />
            )}
        </>
    );
}
