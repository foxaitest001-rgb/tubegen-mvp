import { calculateUsagePercentage } from '../services/puter';

interface UsageModalProps {
    isOpen: boolean;
    onClose: () => void;
    usage: { user: any; allowance: any } | null;
    onRefresh: () => void;
    loading: boolean;
}

export default function UsageModal({ isOpen, onClose, usage, onRefresh, loading }: UsageModalProps) {
    if (!isOpen) return null;

    const pct = usage ? calculateUsagePercentage(usage.allowance) : 0;
    const username = usage?.user?.username || usage?.user?.email || "Not signed in";

    // Calculate specific metrics if available in allowance
    // Note: Puter generic allowance object structure might vary, strictly following user snippet for basics.
    // User snippet: appTotals.totalCalls, appTotals.totalCost
    // "usage.allowance" is passed as usage.allowance. 
    // Let's assume usage.allowance contains the properties the user mentioned.
    // Actually, fetchPuterMonthlyUsage returns the whole object.

    const allowance = usage?.allowance || {};
    // Assuming allowance has appTotals based on prompt: "This month: appTotals.totalCalls"
    // If undefined, fallback to 0.
    const totalCalls = allowance.appTotals?.totalCalls || 0;
    const totalCostMicroCents = allowance.appTotals?.totalCost || 0;
    const totalCostUSD = (totalCostMicroCents / 1000000).toFixed(4);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                    <h3 className="font-semibold text-gray-900">API Usage</h3>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-200 text-gray-500 hover:text-red-600 transition-colors">
                        <span className="sr-only">ClosePopup</span>
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    <div className="space-y-1">
                        <p className="text-sm font-medium text-gray-500 uppercase tracking-wider text-xs">Account</p>
                        <p className="font-medium text-gray-900 truncate">{username}</p>
                    </div>

                    <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Monthly Allowance</span>
                            <span className={`font-medium ${(pct || 0) > 90 ? 'text-red-600' : 'text-gray-900'}`}>
                                {pct !== null ? `${Math.round(pct)}%` : 'N/A'}
                            </span>
                        </div>

                        <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-500 ${(pct || 0) > 90 ? 'bg-red-500' :
                                    (pct || 0) > 70 ? 'bg-yellow-500' : 'bg-emerald-500'
                                    }`}
                                style={{ width: `${Math.min(pct || 0, 100)}%` }}
                            ></div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-2">
                        <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                            <p className="text-xs text-gray-500 mb-1">Calls</p>
                            <p className="font-semibold text-gray-900">{totalCalls.toLocaleString()}</p>
                        </div>
                        <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                            <p className="text-xs text-gray-500 mb-1">Cost (Est.)</p>
                            <p className="font-semibold text-gray-900">${totalCostUSD}</p>
                        </div>
                    </div>

                    <button
                        onClick={onRefresh}
                        disabled={loading}
                        className="w-full flex justify-center py-2.5 px-4 rounded-lg bg-gray-900 text-white font-medium text-sm hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                        {loading ? (
                            <span className="flex items-center gap-2">
                                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Refreshing...
                            </span>
                        ) : 'Refresh Usage'}
                    </button>
                </div>
            </div>
        </div>
    );
}
