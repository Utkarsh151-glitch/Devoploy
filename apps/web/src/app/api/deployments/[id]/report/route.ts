import { NextResponse } from 'next/server';
import { getDeploymentById, getDeploymentLogs, getLatestWorkflowAnalysisForRepo } from 'database';
import { parseGitHubRepo } from '@/lib/repo';

export const runtime = 'nodejs';

function extract(logs: Array<{ message: string }>) {
    const find = (prefix: string) => logs.find((log) => log.message.startsWith(prefix))?.message || '';
    return {
        rulesDiff: find('Diff preview:\n').replace(/^Diff preview:\n/, ''),
        aiDiff: find('AI diff preview:\n').replace(/^AI diff preview:\n/, ''),
        rulesFix: find('Applying '),
        aiSummary: find('AI fix summary: ').replace(/^AI fix summary:\s*/, ''),
        aiFiles: find('AI changed files: ').replace(/^AI changed files:\s*/, ''),
    };
}

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await context.params;
        const deployment = await getDeploymentById(id);
        if (!deployment) {
            return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
        }

        const logs = await getDeploymentLogs(id);
        const repo = parseGitHubRepo(deployment.original_repo);
        const analysis = repo ? await getLatestWorkflowAnalysisForRepo(repo.owner, repo.name) : null;
        const extracted = extract(logs);

        const report = {
            generatedAt: new Date().toISOString(),
            deployment,
            classification: analysis
                ? {
                    category: analysis.category,
                    confidence: analysis.confidence,
                    extractedError: analysis.extracted_error,
                    suggestedFixType: analysis.suggested_fix_type,
                    ruleMatched: analysis.rule_matched,
                    whyThisFix: analysis.why_this_fix,
                    originalLogSnippet: analysis.original_log_snippet,
                }
                : null,
            rulesEngine: {
                fixApplied: extracted.rulesFix,
                diffPreview: extracted.rulesDiff,
            },
            aiEngine: {
                enabled: Boolean(extracted.aiSummary || extracted.aiFiles || extracted.aiDiff),
                summary: extracted.aiSummary,
                changedFiles: extracted.aiFiles ? extracted.aiFiles.split(',').map((item) => item.trim()).filter(Boolean) : [],
                diffPreview: extracted.aiDiff,
            },
            logs,
        };

        return new NextResponse(JSON.stringify(report, null, 2), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Content-Disposition': `attachment; filename=\"deployment-report-${id}.json\"`,
            },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown report error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
