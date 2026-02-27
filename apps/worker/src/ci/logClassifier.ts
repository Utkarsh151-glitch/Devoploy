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
}

export interface ClassifiedCiError {
    category: CiErrorCategory;
    confidence: number;
    extractedError: string;
    suggestedFixType: string;
}

interface CategoryRule {
    category: Exclude<CiErrorCategory, 'UNKNOWN'>;
    confidence: number;
    patterns: RegExp[];
}

const ERROR_LINE_HINT = /(error|err!|failed|fatal|exception|timed out|timeout|heap out of memory|cannot find module|module not found|eaddrinuse|missing script|eslint|error ts\d{4})/i;

const CATEGORY_RULES: CategoryRule[] = [
    {
        category: 'NODE_VERSION_MISMATCH',
        confidence: 0.94,
        patterns: [
            /The engine ["']node["'] is incompatible with this module/i,
            /Expected (?:node|node\.js) version/i,
            /Unsupported engine.*node/i,
            /requires node/i,
        ],
    },
    {
        category: 'MODULE_NOT_FOUND',
        confidence: 0.95,
        patterns: [
            /Cannot find module ['"`].+['"`]/i,
            /Module not found: Can't resolve ['"`].+['"`]/i,
            /Error: Cannot find package ['"`].+['"`]/i,
        ],
    },
    {
        category: 'BUILD_SCRIPT_MISSING',
        confidence: 0.97,
        patterns: [
            /Missing script: ["']?build["']?/i,
            /npm ERR! missing script: build/i,
            /could not determine executable to run.*build/i,
        ],
    },
    {
        category: 'ENV_VARIABLE_MISSING',
        confidence: 0.93,
        patterns: [
            /Missing required env(?:ironment)? variable:? [A-Z0-9_]+/i,
            /Environment variable ["'][A-Z0-9_]+["'] is not set/i,
            /process\.env\.[A-Z0-9_]+(?:\s|.){0,24}(?:undefined|not defined|missing)/i,
        ],
    },
    {
        category: 'MEMORY_LIMIT_EXCEEDED',
        confidence: 0.96,
        patterns: [
            /JavaScript heap out of memory/i,
            /Allocation failed - JavaScript heap out of memory/i,
            /FATAL ERROR: Reached heap limit/i,
            /Out of memory/i,
        ],
    },
    {
        category: 'TIMEOUT',
        confidence: 0.9,
        patterns: [
            /\bETIMEDOUT\b/i,
            /timed out after \d+/i,
            /build .* timed out/i,
            /Timeout of \d+ms exceeded/i,
        ],
    },
    {
        category: 'TYPESCRIPT_COMPILE_ERROR',
        confidence: 0.98,
        patterns: [
            /\berror TS\d{4}:/i,
            /Type ['"`].+['"`] is not assignable to type/i,
            /Cannot find name ['"`].+['"`]/i,
        ],
    },
    {
        category: 'ESLINT_BLOCKING_BUILD',
        confidence: 0.9,
        patterns: [
            /ESLint found \d+ errors?/i,
            /Failed to compile\..*ESLint/s,
            /Linting and checking validity of types.*Failed/i,
            /no-unused-vars|@typescript-eslint\//i,
        ],
    },
    {
        category: 'PORT_BINDING_ERROR',
        confidence: 0.97,
        patterns: [
            /\bEADDRINUSE\b/i,
            /address already in use/i,
            /listen EACCES/i,
            /port \d+ .*already in use/i,
        ],
    },
];

const FIX_TYPE_BY_CATEGORY: Record<CiErrorCategory, string> = {
    NODE_VERSION_MISMATCH: 'UPDATE_RUNTIME_VERSION',
    MODULE_NOT_FOUND: 'INSTALL_OR_FIX_DEPENDENCY',
    BUILD_SCRIPT_MISSING: 'ADD_OR_FIX_BUILD_SCRIPT',
    ENV_VARIABLE_MISSING: 'DEFINE_REQUIRED_ENV_VARS',
    MEMORY_LIMIT_EXCEEDED: 'INCREASE_MEMORY_LIMIT_OR_OPTIMIZE_BUILD',
    TIMEOUT: 'INCREASE_TIMEOUT_OR_OPTIMIZE_BUILD',
    TYPESCRIPT_COMPILE_ERROR: 'FIX_TYPESCRIPT_ERRORS',
    ESLINT_BLOCKING_BUILD: 'FIX_OR_RELAX_LINT_ERRORS',
    PORT_BINDING_ERROR: 'USE_DYNAMIC_OR_FREE_PORT',
    UNKNOWN: 'MANUAL_INVESTIGATION_REQUIRED',
};

export function extractErrorBlocks(rawLog: string): ErrorBlock[] {
    const lines = rawLog.split(/\r?\n/);
    const blocks: ErrorBlock[] = [];

    for (let i = 0; i < lines.length; i += 1) {
        if (!ERROR_LINE_HINT.test(lines[i])) {
            continue;
        }

        const start = Math.max(0, i - 2);
        let end = Math.min(lines.length - 1, i + 4);

        for (let j = i + 1; j < Math.min(lines.length, i + 15); j += 1) {
            const line = lines[j];
            if (!line.trim()) {
                break;
            }
            end = j;
            if (!/^\s+at\s|^\s*Error:|^\s*Caused by:|^\s*[-\w./\\]+:\d+/.test(line) && !ERROR_LINE_HINT.test(line)) {
                break;
            }
        }

        const text = lines.slice(start, end + 1).join('\n').trim();
        if (!text) continue;

        const last = blocks[blocks.length - 1];
        if (last && start <= last.endLine + 1) {
            last.endLine = Math.max(last.endLine, end);
            last.text = lines.slice(last.startLine, last.endLine + 1).join('\n').trim();
        } else {
            blocks.push({ startLine: start + 1, endLine: end + 1, text });
        }
    }

    return blocks;
}

function classifyBlock(block: string): ClassifiedCiError | null {
    for (const rule of CATEGORY_RULES) {
        for (const pattern of rule.patterns) {
            const match = block.match(pattern);
            if (!match) continue;

            return {
                category: rule.category,
                confidence: rule.confidence,
                extractedError: block,
                suggestedFixType: FIX_TYPE_BY_CATEGORY[rule.category],
            };
        }
    }

    return null;
}

export function classifyCiLog(rawLog: string): ClassifiedCiError {
    const blocks = extractErrorBlocks(rawLog);
    let best: ClassifiedCiError | null = null;

    for (const block of blocks) {
        const classified = classifyBlock(block.text);
        if (!classified) continue;
        if (!best || classified.confidence > best.confidence) {
            best = classified;
        }
    }

    if (best) return best;

    const fallback = rawLog.slice(0, 400).trim() || 'No recognizable error block found.';
    return {
        category: 'UNKNOWN',
        confidence: 0.2,
        extractedError: fallback,
        suggestedFixType: FIX_TYPE_BY_CATEGORY.UNKNOWN,
    };
}
