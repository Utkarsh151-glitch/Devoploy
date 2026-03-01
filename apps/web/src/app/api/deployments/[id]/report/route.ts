import { NextResponse } from 'next/server';
import { getDeploymentById, getDeploymentLogs, getLatestWorkflowAnalysisForRepo } from 'database';
import { parseGitHubRepo } from '@/lib/repo';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const runtime = 'nodejs';

type DeploymentLog = {
    created_at: string;
    log_level: string;
    message: string;
};

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

function sanitizeText(value: unknown): string {
    return String(value ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?');
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
    const result: string[] = [];
    const normalized = sanitizeText(text);
    const rawLines = normalized.split('\n');

    for (const rawLine of rawLines) {
        if (!rawLine.trim()) {
            result.push('');
            continue;
        }
        let line = '';
        for (const word of rawLine.split(' ')) {
            const candidate = line ? `${line} ${word}` : word;
            if (candidate.length > maxCharsPerLine) {
                if (line) result.push(line);
                line = word;
            } else {
                line = candidate;
            }
        }
        if (line) result.push(line);
    }

    return result;
}

function parseIssueSummary(logs: DeploymentLog[]) {
    const issueMessage = logs.find((log) => log.message.startsWith('Detected issues:'))?.message ?? 'Detected issues: none';
    const changedFiles = logs.find((log) => log.message.startsWith('Changed files:'))?.message ?? 'Changed files: none';
    const pushed = logs.find((log) => log.message.startsWith('Pushed to '))?.message ?? '';
    return { issueMessage, changedFiles, pushed };
}

async function buildPdfReport(payload: {
    id: string;
    deployment: any;
    classification: any;
    rulesEngine: { fixApplied: string; diffPreview: string };
    aiEngine: { enabled: boolean; summary: string; changedFiles: string[]; diffPreview: string };
    logs: DeploymentLog[];
}) {
    const { id, deployment, classification, rulesEngine, aiEngine, logs } = payload;
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const size = { title: 17, heading: 12, body: 9 };
    const color = { title: rgb(0.05, 0.1, 0.2), heading: rgb(0.12, 0.18, 0.32), body: rgb(0.1, 0.1, 0.1) };

    let page = pdf.addPage([595, 842]);
    const margin = 40;
    const bottom = 38;
    const lineHeight = 12;
    let y = 810;

    const addPage = () => {
        page = pdf.addPage([595, 842]);
        y = 810;
    };

    const ensureSpace = (linesNeeded = 1) => {
        if (y - linesNeeded * lineHeight < bottom) addPage();
    };

    const drawLine = (line: string, kind: 'body' | 'heading' | 'title' = 'body') => {
        const font = kind === 'title' ? bold : kind === 'heading' ? bold : regular;
        const fontSize = kind === 'title' ? size.title : kind === 'heading' ? size.heading : size.body;
        const fontColor = kind === 'title' ? color.title : kind === 'heading' ? color.heading : color.body;
        ensureSpace(1);
        page.drawText(sanitizeText(line), {
            x: margin,
            y,
            size: fontSize,
            font,
            color: fontColor,
        });
        y -= lineHeight + (kind === 'title' ? 8 : kind === 'heading' ? 4 : 0);
    };

    const drawWrappedBlock = (text: string, prefix = '') => {
        const lines = wrapText(text, 108);
        if (lines.length === 0) {
            drawLine(prefix, 'body');
            return;
        }
        for (let i = 0; i < lines.length; i += 1) {
            drawLine(i === 0 ? `${prefix}${lines[i]}` : lines[i], 'body');
        }
    };

    const drawSectionTitle = (title: string) => {
        y -= 6;
        drawLine(title, 'heading');
        y -= 2;
    };

    const { issueMessage, changedFiles, pushed } = parseIssueSummary(logs);

    drawLine('Devoploy Deployment Report', 'title');
    drawLine(`Report ID: ${id}`);
    drawLine(`Generated: ${new Date().toISOString()}`);

    drawSectionTitle('Deployment Summary');
    drawLine(`Status: ${deployment.status ?? 'unknown'}`);
    drawLine(`Target Cloud: ${deployment.target_cloud ?? 'unknown'}`);
    drawLine(`Source Branch: ${deployment.source_branch ?? 'unknown'}`);
    drawLine(`Fixed Branch: ${deployment.fixed_branch ?? 'N/A'}`);
    drawWrappedBlock(`${deployment.original_repo ?? ''}`, 'Original Repo: ');
    if (deployment.fixed_repo_url) drawWrappedBlock(deployment.fixed_repo_url, 'Fixed Repo URL: ');
    drawLine(`Created At: ${deployment.created_at ?? 'N/A'}`);
    drawLine(`Updated At: ${deployment.updated_at ?? 'N/A'}`);

    drawSectionTitle('Detected Issues and Fix Proof');
    drawWrappedBlock(issueMessage);
    drawWrappedBlock(rulesEngine.fixApplied || 'Fix Applied: N/A', 'Fix Action: ');
    drawWrappedBlock(changedFiles);
    if (pushed) drawWrappedBlock(pushed);

    drawSectionTitle('Classification');
    if (classification) {
        drawLine(`Category: ${classification.category ?? 'N/A'}`);
        drawLine(`Confidence: ${classification.confidence ?? 'N/A'}`);
        drawWrappedBlock(classification.suggestedFixType || '', 'Suggested Fix Type: ');
        drawWrappedBlock(classification.ruleMatched || '', 'Rule Matched: ');
        drawWrappedBlock(classification.whyThisFix || '', 'Why This Fix: ');
    } else {
        drawLine('No workflow classification linked for this deployment.');
    }

    drawSectionTitle('AI Engine');
    drawLine(`Enabled: ${aiEngine.enabled ? 'Yes' : 'No'}`);
    drawWrappedBlock(aiEngine.summary || 'No AI summary available.', 'Summary: ');
    drawWrappedBlock(
        aiEngine.changedFiles.length > 0 ? aiEngine.changedFiles.join(', ') : 'No AI changed files.',
        'Changed Files: ',
    );

    drawSectionTitle('Rules Diff Preview');
    drawWrappedBlock(rulesEngine.diffPreview || 'No rules diff available.');

    drawSectionTitle('AI Diff Preview');
    drawWrappedBlock(aiEngine.diffPreview || 'No AI diff available.');

    drawSectionTitle('Execution Logs');
    for (const log of logs) {
        const logLine = `[${log.created_at}] [${log.log_level}] ${log.message}`;
        const wrapped = wrapText(logLine, 108);
        ensureSpace(Math.max(1, wrapped.length));
        for (const line of wrapped) drawLine(line);
    }

    const bytes = await pdf.save();
    return bytes;
}

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
    try {
        const url = new URL(req.url);
        const format = (url.searchParams.get('format') || 'pdf').toLowerCase();
        const { id } = await context.params;
        const deployment = await getDeploymentById(id);
        if (!deployment) {
            return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
        }

        const logs = await getDeploymentLogs(id) as DeploymentLog[];
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

        if (format === 'json') {
            return new NextResponse(JSON.stringify(report, null, 2), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Disposition': `attachment; filename=\"deployment-report-${id}.json\"`,
                },
            });
        }

        const pdf = await buildPdfReport({
            id,
            deployment,
            classification: report.classification,
            rulesEngine: report.rulesEngine,
            aiEngine: report.aiEngine,
            logs: report.logs,
        });
        const pdfBuffer = Buffer.from(pdf);

        return new NextResponse(pdfBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename=\"deployment-report-${id}.pdf\"`,
                'Cache-Control': 'no-store',
            },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown report error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
