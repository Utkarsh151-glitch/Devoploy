export type CiErrorCategory =
    | 'NODE_VERSION_MISMATCH'
    | 'MODULE_NOT_FOUND'
    | 'BUILD_SCRIPT_MISSING'
    | 'ENV_VARIABLE_MISSING'
    | 'MEMORY_LIMIT_EXCEEDED'
    | 'TIMEOUT'
    | 'TYPESCRIPT_COMPILE_ERROR'
    | 'ESLINT_BLOCKING_BUILD'
    | 'PORT_BINDING_ERROR'
    | 'UNKNOWN';

export interface ErrorBlock {
    startLine: number;
    endLine: number;
    text: string;
    originalText: string;
}

export interface ClassifiedCiError {
    category: CiErrorCategory;
    confidence: number;
    extractedError: string;
    originalLogSnippet: string;
    suggestedFixType: string;
    explainability: {
        ruleMatched: string;
        whyThisFix: string;
    };
}

interface RulePattern {
    id: string;
    regex: RegExp;
}

interface CategoryRule {
    category: Exclude<CiErrorCategory, 'UNKNOWN'>;
    confidence: number;
    fixType: string;
    whyThisFix: string;
    patterns: RulePattern[];
}

const ERROR_LINE_HINT =
    /(error|err!|failed|fatal|exception|timed out|timeout|heap out of memory|cannot find module|module not found|eaddrinuse|missing script|eslint|error ts\d{4})/i;

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

const CATEGORY_RULES: CategoryRule[] = [
    {
        category: 'NODE_VERSION_MISMATCH',
        confidence: 0.95,
        fixType: 'UPDATE_RUNTIME_VERSION',
        whyThisFix: 'Log indicates Node engine/version incompatibility during install/build.',
        patterns: [
            { id: 'NODE_ENGINE_INCOMPATIBLE', regex: /The engine ["']node["'] is incompatible with this module/i },
            { id: 'NODE_VERSION_EXPECTED', regex: /Expected (?:node|node\.js) version/i },
            { id: 'NODE_UNSUPPORTED_ENGINE', regex: /Unsupported engine.*node/i },
            { id: 'NODE_REQUIRED_VERSION', regex: /requires node/i },
        ],
    },
    {
        category: 'MODULE_NOT_FOUND',
        confidence: 0.96,
        fixType: 'INSTALL_OR_FIX_DEPENDENCY',
        whyThisFix: 'Build/runtime failed because a module or package could not be resolved.',
        patterns: [
            { id: 'MODULE_CANNOT_FIND', regex: /Cannot find module ['"`].+['"`]/i },
            { id: 'MODULE_CANT_RESOLVE', regex: /Module not found: Can't resolve ['"`].+['"`]/i },
            { id: 'PACKAGE_CANNOT_FIND', regex: /Error: Cannot find package ['"`].+['"`]/i },
        ],
    },
    {
        category: 'BUILD_SCRIPT_MISSING',
        confidence: 0.97,
        fixType: 'ADD_OR_FIX_BUILD_SCRIPT',
        whyThisFix: 'CI invoked build but project scripts do not define a valid build command.',
        patterns: [
            { id: 'NPM_MISSING_BUILD_SCRIPT', regex: /Missing script: ["']?build["']?/i },
            { id: 'NPM_ERR_BUILD_SCRIPT', regex: /npm ERR! missing script: build/i },
            { id: 'NO_BUILD_EXECUTABLE', regex: /could not determine executable to run.*build/i },
        ],
    },
    {
        category: 'ENV_VARIABLE_MISSING',
        confidence: 0.94,
        fixType: 'DEFINE_REQUIRED_ENV_VARS',
        whyThisFix: 'A required environment variable is missing or undefined.',
        patterns: [
            { id: 'MISSING_REQUIRED_ENV', regex: /Missing required env(?:ironment)? variable:? [A-Z0-9_]+/i },
            { id: 'ENV_NOT_SET', regex: /Environment variable ["'][A-Z0-9_]+["'] is not set/i },
            { id: 'PROCESS_ENV_UNDEFINED', regex: /process\.env\.[A-Z0-9_]+(?:\s|.){0,24}(?:undefined|not defined|missing)/i },
        ],
    },
    {
        category: 'MEMORY_LIMIT_EXCEEDED',
        confidence: 0.96,
        fixType: 'INCREASE_MEMORY_LIMIT_OR_OPTIMIZE_BUILD',
        whyThisFix: 'Node process hit heap/memory limit during build.',
        patterns: [
            { id: 'HEAP_OUT_OF_MEMORY', regex: /JavaScript heap out of memory/i },
            { id: 'HEAP_ALLOCATION_FAILED', regex: /Allocation failed - JavaScript heap out of memory/i },
            { id: 'HEAP_LIMIT_REACHED', regex: /FATAL ERROR: Reached heap limit/i },
            { id: 'OUT_OF_MEMORY', regex: /Out of memory/i },
        ],
    },
    {
        category: 'TIMEOUT',
        confidence: 0.9,
        fixType: 'INCREASE_TIMEOUT_OR_OPTIMIZE_BUILD',
        whyThisFix: 'Build/external operation exceeded configured timeout.',
        patterns: [
            { id: 'ETIMEDOUT', regex: /\bETIMEDOUT\b/i },
            { id: 'TIMED_OUT_AFTER', regex: /timed out after \d+/i },
            { id: 'BUILD_TIMED_OUT', regex: /build .* timed out/i },
            { id: 'TIMEOUT_EXCEEDED', regex: /Timeout of \d+ms exceeded/i },
        ],
    },
    {
        category: 'TYPESCRIPT_COMPILE_ERROR',
        confidence: 0.98,
        fixType: 'FIX_TYPESCRIPT_ERRORS',
        whyThisFix: 'TypeScript compiler reported typed compile-time errors.',
        patterns: [
            { id: 'TS_ERROR_CODE', regex: /\berror TS\d{4}:/i },
            { id: 'TS_ASSIGNABILITY', regex: /Type ['"`].+['"`] is not assignable to type/i },
            { id: 'TS_CANNOT_FIND_NAME', regex: /Cannot find name ['"`].+['"`]/i },
        ],
    },
    {
        category: 'ESLINT_BLOCKING_BUILD',
        confidence: 0.9,
        fixType: 'FIX_OR_RELAX_LINT_ERRORS',
        whyThisFix: 'Lint errors are configured to fail the CI build.',
        patterns: [
            { id: 'ESLINT_FOUND_ERRORS', regex: /ESLint found \d+ errors?/i },
            { id: 'FAILED_COMPILE_ESLINT', regex: /Failed to compile\..*ESLint/s },
            { id: 'LINTING_FAILED', regex: /Linting and checking validity of types.*Failed/i },
            { id: 'ESLINT_RULE_FAILURE', regex: /no-unused-vars|@typescript-eslint\//i },
        ],
    },
    {
        category: 'PORT_BINDING_ERROR',
        confidence: 0.97,
        fixType: 'USE_DYNAMIC_OR_FREE_PORT',
        whyThisFix: 'Service failed to bind to requested port because it is unavailable.',
        patterns: [
            { id: 'EADDRINUSE', regex: /\bEADDRINUSE\b/i },
            { id: 'ADDRESS_ALREADY_IN_USE', regex: /address already in use/i },
            { id: 'LISTEN_EACCES', regex: /listen EACCES/i },
            { id: 'PORT_ALREADY_IN_USE', regex: /port \d+ .*already in use/i },
        ],
    },
];

function normalizeLog(rawLog: string): string {
    return rawLog
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(ANSI_PATTERN, '')
        .replace(/\t/g, '    ')
        .replace(/\u0000/g, '')
        .trim();
}

function dedupeLines(text: string): string {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const line of text.split('\n')) {
        const normalized = line.trim().replace(/\s+/g, ' ');
        if (!normalized) continue;
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(line);
    }
    return result.join('\n').trim();
}

export function extractErrorBlocks(rawLog: string): ErrorBlock[] {
    const normalizedLog = normalizeLog(rawLog);
    const lines = normalizedLog.split('\n');
    const blocks: ErrorBlock[] = [];

    for (let i = 0; i < lines.length; i += 1) {
        if (!ERROR_LINE_HINT.test(lines[i])) continue;

        const start = Math.max(0, i - 2);
        let end = Math.min(lines.length - 1, i + 4);

        for (let j = i + 1; j < Math.min(lines.length, i + 20); j += 1) {
            const line = lines[j];
            if (!line.trim()) break;
            end = j;
            if (
                !/^\s+at\s|^\s*Error:|^\s*Caused by:|^\s*[-\w./\\]+:\d+/.test(line) &&
                !ERROR_LINE_HINT.test(line)
            ) {
                break;
            }
        }

        const originalText = lines.slice(start, end + 1).join('\n').trim();
        if (!originalText) continue;

        const text = dedupeLines(originalText);
        const last = blocks[blocks.length - 1];
        if (last && start <= last.endLine + 1) {
            last.endLine = Math.max(last.endLine, end + 1);
            last.originalText = lines.slice(last.startLine - 1, last.endLine).join('\n').trim();
            last.text = dedupeLines(last.originalText);
        } else {
            blocks.push({ startLine: start + 1, endLine: end + 1, text, originalText });
        }
    }

    return blocks;
}

function classifyBlock(block: ErrorBlock): ClassifiedCiError | null {
    for (const rule of CATEGORY_RULES) {
        for (const pattern of rule.patterns) {
            if (!pattern.regex.test(block.text)) continue;
            return {
                category: rule.category,
                confidence: rule.confidence,
                extractedError: block.text,
                originalLogSnippet: block.originalText.slice(0, 4000),
                suggestedFixType: rule.fixType,
                explainability: {
                    ruleMatched: `${rule.category}.${pattern.id}`,
                    whyThisFix: rule.whyThisFix,
                },
            };
        }
    }

    return null;
}

export function classifyCiLog(rawLog: string): ClassifiedCiError {
    const normalized = normalizeLog(rawLog);
    const blocks = extractErrorBlocks(normalized);
    let best: ClassifiedCiError | null = null;

    for (const block of blocks) {
        const classified = classifyBlock(block);
        if (!classified) continue;
        if (!best || classified.confidence > best.confidence) {
            best = classified;
        }
    }

    if (best) return best;

    const fallback = normalized.slice(0, 400).trim() || 'No recognizable error block found.';
    return {
        category: 'UNKNOWN',
        confidence: 0.2,
        extractedError: fallback,
        originalLogSnippet: fallback,
        suggestedFixType: 'MANUAL_INVESTIGATION_REQUIRED',
        explainability: {
            ruleMatched: 'UNKNOWN.NO_RULE_MATCH',
            whyThisFix: 'No deterministic classification rule matched this log.',
        },
    };
}
