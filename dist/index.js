"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const dotenv = __importStar(require("dotenv"));
const genai_1 = require("@google/genai");
const pinecone_query_1 = require("./pinecone-query");
const llm_suggester_1 = require("./llm-suggester");
const pr_comment_1 = require("./pr-comment");
// Load .env if running locally
if (!process.env.GITHUB_ACTIONS) {
    dotenv.config();
}
function getInput(name, required = false) {
    const actionInput = core.getInput(name, { required: false });
    if (actionInput)
        return actionInput;
    const envVarName = `INPUT_${name.toUpperCase().replace(/-/g, '_')}`;
    const envValue = process.env[envVarName] || process.env[name.toUpperCase()];
    if (!envValue && required) {
        throw new Error(`Required input '${name}' not provided`);
    }
    return envValue || '';
}
function normalizeModelName(model) {
    if (!model)
        return 'models/gemini-2.5-pro';
    return model.startsWith('models/') ? model : `models/${model}`;
}
async function buildSearchQuery(geminiApiKey, geminiModel, prTitle, prBody, files) {
    const genai = new genai_1.GoogleGenAI({ apiKey: geminiApiKey });
    const fileSnippets = files.slice(0, 5).map(f => {
        const patch = (f.patch || '').slice(0, 1200);
        return `File: ${f.filename}\nDiff: ${patch}`;
    }).join('\n\n');
    const prompt = [
        'Summarize this PR into a concise documentation search query.',
        'Output a single sentence, <=200 characters, no bullet points.',
        'Focus on key components, APIs, or docs topics that would help review the PR.',
        `PR title: ${prTitle}`,
        `PR body: ${prBody || '(empty)'}`,
        'Files and diffs (truncated):',
        fileSnippets || '(no diff available)'
    ].join('\n');
    core.info(`[SearchQuery] Prompt length: ${prompt.length}, files considered: ${Math.min(files.length, 5)}`);
    const response = await genai.models.generateContent({
        model: geminiModel,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
            temperature: 0,
            maxOutputTokens: 8192,
            responseMimeType: 'text/plain'
        }
    });
    const candidate = response.candidates?.[0];
    // Prefer the nested response.text() when present (GenerateContentResult shape), otherwise fall back to the direct getter.
    const responseText = response.response?.text?.();
    const text = (responseText ?? response.text ?? '').trim();
    const finishReason = candidate?.finishReason || 'unknown';
    const safetyRatings = candidate?.safetyRatings || [];
    const promptFeedback = response.promptFeedback;
    const usage = response.usageMetadata;
    const candidateDebug = candidate ? JSON.stringify(candidate).slice(0, 2000) : 'none';
    core.info(`[SearchQuery] textLen=${text.length}, finish=${finishReason}, safety=${JSON.stringify(safetyRatings)}, promptFeedback=${JSON.stringify(promptFeedback)}, usage=${JSON.stringify(usage)}, candidateSnippet=${candidateDebug}`);
    if (text) {
        return text.slice(0, 200);
    }
    // Heuristic fallback to keep Pinecone queries non-empty when Gemini returns nothing
    core.info('Gemini returned an empty search query, using heuristic fallback.');
    const fallback = [
        prTitle || 'PR changes',
        files.slice(0, 5).map(f => f.filename).join(', '),
        prBody || ''
    ].filter(Boolean).join(' | ');
    return fallback ? fallback.slice(0, 200) : 'Documentation search for PR changes';
}
async function run() {
    try {
        // Get inputs
        const pineconeApiKey = getInput('pinecone_api_key', true);
        const pineconeIndex = getInput('pinecone_index', true);
        const geminiApiKey = getInput('gemini_api_key', true);
        const geminiModel = normalizeModelName(getInput('gemini_model') || 'gemini-2.5-pro');
        const githubToken = getInput('github_token', true);
        const topK = parseInt(getInput('top_k') || '5', 10);
        const promptInstruction = getInput('prompt_instruction');
        // Get PR context
        const context = github.context;
        const prNumber = parseInt(getInput('pr_number') || String(context.payload.pull_request?.number || 0), 10);
        const repo = getInput('repo') || context.payload.repository?.full_name || '';
        if (!prNumber || !repo) {
            throw new Error('Could not determine PR number or repository');
        }
        const [owner, repoName] = repo.split('/');
        core.info('='.repeat(60));
        core.info('Soyio Docs Bot');
        core.info('='.repeat(60));
        core.info(`Repository: ${repo}`);
        core.info(`PR: #${prNumber}`);
        core.info(`Pinecone index: ${pineconeIndex}`);
        core.info(`Gemini model: ${geminiModel}`);
        core.info(`Top K: ${topK}`);
        if (promptInstruction) {
            core.info('Custom prompt instruction detected (not printed for safety).');
        }
        core.info('='.repeat(60));
        // Get PR data
        const octokit = github.getOctokit(githubToken);
        const { data: pr } = await octokit.rest.pulls.get({
            owner,
            repo: repoName,
            pull_number: prNumber
        });
        const { data: files } = await octokit.rest.pulls.listFiles({
            owner,
            repo: repoName,
            pull_number: prNumber
        });
        // Build base query from PR context
        const baseQuery = [
            pr.title,
            pr.body || '',
            ...files.map(f => `${f.filename}: ${f.patch || ''}`).slice(0, 5)
        ].join('\n').substring(0, 5000);
        let pineconeQueryText = baseQuery;
        // Try to summarize into a focused search query
        try {
            core.info('Generating focused search query with Gemini...');
            pineconeQueryText = await buildSearchQuery(geminiApiKey, geminiModel, pr.title, pr.body || '', files);
            core.info(`Search query: ${pineconeQueryText}`);
        }
        catch (err) {
            const message = err?.message || 'unknown error';
            core.warning(`Falling back to raw PR text for Pinecone search: ${message}`);
            pineconeQueryText = baseQuery;
        }
        // Build full diff
        const diff = files.map(f => `--- ${f.filename}\n${f.patch || ''}`).join('\n\n');
        // Step 1: Query Pinecone
        core.info(`\n[1/3] Querying Pinecone for relevant docs...`);
        const docsContext = await (0, pinecone_query_1.queryPinecone)(pineconeApiKey, pineconeIndex, geminiApiKey, pineconeQueryText, topK);
        core.info(`Found ${docsContext.length} relevant documentation chunks`);
        docsContext.forEach((r, i) => {
            core.info(`  ${i + 1}. ${r.file} (lines ${r.startLine}-${r.endLine}) - score: ${r.score.toFixed(3)}`);
        });
        // Step 2: Generate suggestions
        core.info(`\n[2/3] Generating suggestions with Gemini...`);
        const response = await (0, llm_suggester_1.generateSuggestions)(geminiApiKey, geminiModel, pr.title, pr.body || '', diff, docsContext, promptInstruction, pr_comment_1.SUGGESTIONS_INTRO);
        core.info(`Impact: ${response.impact_level}, Suggestions: ${response.suggestions.length}`);
        // Format comment
        const comment = (0, pr_comment_1.formatComment)(response);
        // Step 3: Post comment (or print if dry-run)
        const isDryRun = process.env.DRY_RUN === 'true';
        if (isDryRun) {
            core.info(`\n[3/3] DRY RUN - Comment preview:`);
            core.info('\n' + '='.repeat(60));
            console.log(comment);
            core.info('='.repeat(60));
            core.info('\n💡 To post this comment, remove DRY_RUN=true from .env');
        }
        else {
            core.info(`\n[3/3] Posting comment to PR...`);
            await (0, pr_comment_1.postComment)(githubToken, owner, repoName, prNumber, comment);
        }
        // Set outputs
        core.setOutput('suggestions_count', response.suggestions.length);
        core.setOutput('impact_level', response.impact_level);
        core.info('\n' + '='.repeat(60));
        core.info('✅ Analysis complete!');
        core.info(`   Impact: ${response.impact_level}`);
        core.info(`   Suggestions: ${response.suggestions.length}`);
        core.info('='.repeat(60));
    }
    catch (error) {
        const err = error;
        core.setFailed(`Bot failed: ${err.message}`);
        if (!process.env.GITHUB_ACTIONS) {
            console.error(`\n❌ Error: ${err.message}`);
            console.error(err.stack);
            process.exit(1);
        }
    }
}
run();
