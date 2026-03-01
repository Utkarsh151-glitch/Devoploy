'use client';

import { motion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

const colorByTone = {
    info: 'from-blue-400/40 to-cyan-300/0',
    success: 'from-emerald-400/35 to-emerald-300/0',
    warning: 'from-amber-400/35 to-amber-300/0',
    error: 'from-rose-400/35 to-rose-300/0',
};

export function MetricCard({
    label,
    value,
    tone = 'info',
    trend = 0,
    sparkline = [2, 3, 4, 3, 6, 5, 7],
}: {
    label: string;
    value: string | number;
    tone?: 'info' | 'success' | 'warning' | 'error';
    trend?: number;
    sparkline?: number[];
}) {
    const max = Math.max(...sparkline, 1);
    const points = sparkline.map((point, i) => `${(i / Math.max(sparkline.length - 1, 1)) * 100},${100 - (point / max) * 100}`).join(' ');
    const positive = trend >= 0;

    return (
        <motion.div
            whileHover={{ y: -4 }}
            transition={{ duration: 0.2 }}
            className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[#0f162a]/85 p-4 shadow-[0_14px_30px_rgba(2,8,20,0.35)]"
        >
            <div className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r ${colorByTone[tone]}`} />
            <p className="text-xs uppercase tracking-[0.12em] text-white/50">{label}</p>
            <div className="mt-2 flex items-end justify-between gap-3">
                <p className="text-3xl font-semibold tracking-tight">{value}</p>
                <div className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${positive ? 'border-emerald-400/30 text-emerald-300' : 'border-rose-400/30 text-rose-300'}`}>
                    {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {Math.abs(trend)}%
                </div>
            </div>
            <div className="mt-3">
                <svg viewBox="0 0 100 32" className="h-8 w-full">
                    <polyline
                        fill="none"
                        stroke="rgba(148, 163, 197, 0.25)"
                        strokeWidth="1.8"
                        points={points}
                    />
                    <polyline
                        fill="none"
                        stroke="rgba(59, 130, 246, 0.8)"
                        strokeWidth="1.8"
                        points={points}
                    />
                </svg>
            </div>
        </motion.div>
    );
}
