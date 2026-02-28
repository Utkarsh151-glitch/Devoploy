import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCiLog, extractErrorBlocks } from '../src/ci/logClassifier';

test('extracts error blocks from raw logs', () => {
    const log = [
        'Step 1/3: npm ci',
        'Step 2/3: npm run build',
        'Error: Cannot find module "express"',
        '    at Function.Module._resolveFilename (internal/modules/cjs/loader.js:889:15)',
        '',
        'build complete',
    ].join('\n');

    const blocks = extractErrorBlocks(log);
    assert.equal(blocks.length, 1);
    assert.match(blocks[0].text, /Cannot find module/i);
});

test('deduplicates repeated error lines inside extracted block', () => {
    const log = [
        'Error: Cannot find module "dotenv-safe"',
        'Error: Cannot find module "dotenv-safe"',
        'Error: Cannot find module "dotenv-safe"',
    ].join('\n');

    const blocks = extractErrorBlocks(log);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].text.split('\n').length, 1);
});

test('classifies NODE_VERSION_MISMATCH', () => {
    const result = classifyCiLog('npm ERR! The engine "node" is incompatible with this module. Expected version ">=20".');
    assert.equal(result.category, 'NODE_VERSION_MISMATCH');
});

test('classifies MODULE_NOT_FOUND', () => {
    const result = classifyCiLog('Error: Cannot find module "dotenv-safe"');
    assert.equal(result.category, 'MODULE_NOT_FOUND');
});

test('classifies BUILD_SCRIPT_MISSING', () => {
    const result = classifyCiLog('npm ERR! Missing script: "build"');
    assert.equal(result.category, 'BUILD_SCRIPT_MISSING');
});

test('classifies ENV_VARIABLE_MISSING', () => {
    const result = classifyCiLog('Error: Missing required environment variable: DATABASE_URL');
    assert.equal(result.category, 'ENV_VARIABLE_MISSING');
});

test('classifies MEMORY_LIMIT_EXCEEDED', () => {
    const result = classifyCiLog('FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory');
    assert.equal(result.category, 'MEMORY_LIMIT_EXCEEDED');
});

test('classifies TIMEOUT', () => {
    const result = classifyCiLog('Build timed out after 600 seconds.');
    assert.equal(result.category, 'TIMEOUT');
});

test('classifies TYPESCRIPT_COMPILE_ERROR', () => {
    const result = classifyCiLog("src/app.ts(14,6): error TS2304: Cannot find name 'windowz'.");
    assert.equal(result.category, 'TYPESCRIPT_COMPILE_ERROR');
});

test('classifies ESLINT_BLOCKING_BUILD', () => {
    const result = classifyCiLog('Failed to compile.\nESLint found 2 errors.');
    assert.equal(result.category, 'ESLINT_BLOCKING_BUILD');
});

test('classifies PORT_BINDING_ERROR', () => {
    const result = classifyCiLog('Error: listen EADDRINUSE: address already in use :::3000');
    assert.equal(result.category, 'PORT_BINDING_ERROR');
});

test('returns structured shape', () => {
    const result = classifyCiLog('npm ERR! Missing script: "build"');
    assert.equal(typeof result.category, 'string');
    assert.equal(typeof result.confidence, 'number');
    assert.equal(typeof result.extractedError, 'string');
    assert.equal(typeof result.originalLogSnippet, 'string');
    assert.equal(typeof result.suggestedFixType, 'string');
    assert.equal(typeof result.explainability.ruleMatched, 'string');
    assert.equal(typeof result.explainability.whyThisFix, 'string');
});
