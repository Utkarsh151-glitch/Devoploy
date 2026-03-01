'use client';

import { Fragment, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronUp } from 'lucide-react';

export type DataTableColumn<T> = {
    id: string;
    label: string;
    sortable?: boolean;
    className?: string;
    render: (row: T) => React.ReactNode;
    sortValue?: (row: T) => string | number;
};

export function DataTable<T extends { id: string }>({
    rows,
    columns,
    renderExpanded,
    stickyHeader = true,
    emptyText = 'No results found.',
}: {
    rows: T[];
    columns: DataTableColumn<T>[];
    renderExpanded?: (row: T) => React.ReactNode;
    stickyHeader?: boolean;
    emptyText?: string;
}) {
    const [sortBy, setSortBy] = useState<string | null>(null);
    const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});

    const sortedRows = useMemo(() => {
        if (!sortBy) return rows;
        const column = columns.find((item) => item.id === sortBy);
        if (!column?.sortValue) return rows;

        const sorted = [...rows].sort((a, b) => {
            const av = column.sortValue!(a);
            const bv = column.sortValue!(b);
            if (typeof av === 'number' && typeof bv === 'number') return av - bv;
            return String(av).localeCompare(String(bv));
        });
        return direction === 'asc' ? sorted : sorted.reverse();
    }, [columns, direction, rows, sortBy]);

    return (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0d1324]/80">
            <div className="max-h-[36rem] overflow-auto">
                <table className="min-w-full text-sm">
                    <thead className={`${stickyHeader ? 'sticky top-0 z-10' : ''} bg-[#111a2f]/95 backdrop-blur`}>
                        <tr className="border-b border-white/10 text-left text-white/65">
                            {renderExpanded ? <th className="w-10 px-3 py-3" /> : null}
                            {columns.map((column) => (
                                <th key={column.id} className={`px-4 py-3 ${column.className || ''}`}>
                                    {column.sortable ? (
                                        <button
                                            className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-white/65 hover:text-white"
                                            onClick={() => {
                                                if (sortBy === column.id) {
                                                    setDirection((value) => (value === 'asc' ? 'desc' : 'asc'));
                                                    return;
                                                }
                                                setSortBy(column.id);
                                                setDirection('desc');
                                            }}
                                        >
                                            {column.label}
                                            {sortBy === column.id ? (
                                                direction === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
                                            ) : null}
                                        </button>
                                    ) : (
                                        <span className="text-xs font-semibold uppercase tracking-wide text-white/65">{column.label}</span>
                                    )}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {sortedRows.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length + (renderExpanded ? 1 : 0)} className="px-4 py-12 text-center text-sm text-white/45">
                                    {emptyText}
                                </td>
                            </tr>
                        ) : null}
                        {sortedRows.map((row) => {
                            const isOpen = Boolean(expanded[row.id]);
                            return (
                                <Fragment key={row.id}>
                                    <tr className="border-b border-white/5 text-white/85 transition-colors hover:bg-white/[0.03]">
                                        {renderExpanded ? (
                                            <td className="px-3 py-3">
                                                <button
                                                    className="rounded-md border border-white/10 p-1 text-white/60 hover:text-white"
                                                    onClick={() => setExpanded((state) => ({ ...state, [row.id]: !isOpen }))}
                                                >
                                                    {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                                </button>
                                            </td>
                                        ) : null}
                                        {columns.map((column) => (
                                            <td key={`${row.id}-${column.id}`} className={`px-4 py-3 ${column.className || ''}`}>
                                                {column.render(row)}
                                            </td>
                                        ))}
                                    </tr>
                                    {renderExpanded ? (
                                        <tr>
                                            <td colSpan={columns.length + 1} className="p-0">
                                                <AnimatePresence initial={false}>
                                                    {isOpen ? (
                                                        <motion.div
                                                            initial={{ height: 0, opacity: 0 }}
                                                            animate={{ height: 'auto', opacity: 1 }}
                                                            exit={{ height: 0, opacity: 0 }}
                                                            className="overflow-hidden border-b border-white/5 bg-[#0a1020]/60"
                                                        >
                                                            <div className="px-4 py-4">{renderExpanded(row)}</div>
                                                        </motion.div>
                                                    ) : null}
                                                </AnimatePresence>
                                            </td>
                                        </tr>
                                    ) : null}
                                </Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
