export function formatPercent(value: number): string {
    return `${value.toFixed(1)}%`;
}

export function formatDateTime(value: string): string {
    return new Date(value).toLocaleString();
}

export function shortRepo(repoUrl: string): string {
    const cleaned = repoUrl.replace(/\.git$/, '');
    const match = cleaned.match(/github\.com[:/](.+\/.+)$/i);
    return match?.[1] ?? repoUrl;
}
