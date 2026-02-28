export function parseGitHubRepo(repoUrl: string): { owner: string; name: string } | null {
    const cleaned = repoUrl.replace(/\.git$/, '');
    const match = cleaned.match(/github\.com[:/]([^/]+)\/([^/]+)$/i);
    if (!match?.[1] || !match[2]) return null;
    return { owner: match[1], name: match[2] };
}
