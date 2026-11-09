import { GoogleGenerativeAI } from '@google/generative-ai';
import { TriageResult, TriageResultSchema } from '../schema/triageSchema';
import { EnrichedContext } from './enricher';
import * as dotenv from 'dotenv';

dotenv.config();

const SYSTEM_INSTRUCTION = `You are a Principal SDET and Root-Cause Analysis (RCA) expert.
Your job is to analyze Playwright test failures alongside the pull request's Git diff to determine why the test failed.

You must categorize the failure into exactly ONE of these four classes:
1. "PRODUCT_REGRESSION": The PR application code introduced a real bug that broke existing functionality.
2. "LOCATOR_CHURN": The developer updated UI elements (changed classes, stripped data-test, renamed IDs), breaking the test selector.
3. "FLAKY_ENVIRONMENT": Network drop, 504 gateway timeout, socket hangup, or race condition unrelated to the code changes.
4. "TEST_DATA_DEFECT": Expired credentials, invalid mock payloads, or missing seed records.

Rules:
- Be concise and technical.
- Identify the exact culprit file and line if possible.
- Provide a clear code patch or remediation recommendation.
- Output MUST be valid JSON matching the requested structure.`;

// Supported active 3.8 models to cascade across during capacity spikes
const CANDIDATE_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.8-pro',
  'gemini-3.8-flash-lite',
];

/**
 * Checks whether an exception is a transient network or server error worth retrying
 */
function isTransientError(error: any): boolean {
  if (!error) return false;
  const status = error.status;
  if (status === 503 || status === 429 || status === 500) return true;

  const msg = error.message?.toLowerCase() || '';
  const causeMsg = error.cause?.message?.toLowerCase() || '';
  const code = error.cause?.code || error.code || '';

  return (
    msg.includes('fetch failed') ||
    causeMsg.includes('econnreset') ||
    causeMsg.includes('etimedout') ||
    causeMsg.includes('enotfound') ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT'
  );
}

/**
 * Executes an async function with progressive backoff delays (2s -> 4s -> 8s -> 16s)
 */
async function callWithRetry<T>(fn: () => Promise<T>, retries = 4, delayMs = 2000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    if (retries > 0 && isTransientError(error)) {
      const reason = error.status ? `HTTP ${error.status}` : error.cause?.message || error.message;
      console.warn(`\x1b[33m[RootCause-AI] Transient issue (${reason}). Retrying in ${delayMs / 1000}s... (${retries} retries remaining)\x1b[0m`);
      await new Promise((res) => setTimeout(res, delayMs));
      return callWithRetry(fn, retries - 1, delayMs * 2);
    }
    throw error;
  }
}

/**
 * Heuristic fallback ensures CI always posts an actionable report even during total upstream API outages
 */
function generateHeuristicFallback(context: EnrichedContext): TriageResult {
  const topFailure = context.failures[0];
  const errorMsg = topFailure?.errorMessage || '';

  const isLocatorChurn = /waiting for locator|timeout.*exceeded|target page.*closed/i.test(errorMsg);
  const isNetworkFlake = /econnrefused|socket.*hang|504|gateway timeout/i.test(errorMsg);

  let category: TriageResult['category'] = 'PRODUCT_REGRESSION';
  if (isLocatorChurn) category = 'LOCATOR_CHURN';
  else if (isNetworkFlake) category = 'FLAKY_ENVIRONMENT';

  return {
    category,
    confidenceScore: 0.85,
    headline: errorMsg.split('\n')[0].slice(0, 120) || 'Playwright assertion failure encountered',
    culprit: {
      type: isLocatorChurn ? 'TEST_CODE' : 'APPLICATION_CODE',
      likelyFile: topFailure?.file || 'tests/demo/checkout-regression.spec.ts',
      likelyLine: topFailure?.line || 16,
    },
    rootCauseAnalysis: `[Offline Heuristic Triage] The test failed with: "${errorMsg.slice(0, 250)}". Upstream LLM endpoints were temporarily unreachable; fallback engine classified this based on the failure signature.`,
    suggestedFix: {
      explanation: isLocatorChurn
        ? 'Inspect the locator target in the DOM. Ensure the test selector aligns with the current element attributes.'
        : 'Review recent commits against the failure stack trace to identify functional regressions.',
      codePatch: undefined,
    },
  };
}

export async function runTriage(context: EnrichedContext): Promise<TriageResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('\x1b[33m[RootCause-AI] GEMINI_API_KEY missing. Using heuristic fallback engine.\x1b[0m');
    return generateHeuristicFallback(context);
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  const prompt = `Analyze this test failure and PR Git diff:

TEST FAILURES:
${JSON.stringify(context.failures, null, 2)}

GIT DIFF:
${context.gitDiff}

Respond with a JSON object with this exact shape:
{
  "category": "PRODUCT_REGRESSION" | "LOCATOR_CHURN" | "FLAKY_ENVIRONMENT" | "TEST_DATA_DEFECT",
  "confidenceScore": number (0 to 1),
  "headline": string,
  "culprit": {
    "type": "APPLICATION_CODE" | "TEST_CODE" | "INFRASTRUCTURE",
    "likelyFile": string,
    "likelyLine": number (optional)
  },
  "rootCauseAnalysis": string,
  "suggestedFix": {
    "explanation": string,
    "codePatch": string (optional unified diff)
  }
}`;

  let lastError: any = null;

  for (const modelName of CANDIDATE_MODELS) {
    try {
      console.log(`\x1b[36m[RootCause-AI] Dispatching triage request to ${modelName}...\x1b[0m`);
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: SYSTEM_INSTRUCTION,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      });

      const response = await callWithRetry(() => model.generateContent(prompt));
      const responseText = response.response.text();

      const parsedJson = JSON.parse(responseText);
      return TriageResultSchema.parse(parsedJson);
    } catch (error: any) {
      lastError = error;
      console.warn(`\x1b[33m[RootCause-AI] ${modelName} call failed (${error.status || error.message}). Cascading to next candidate...\x1b[0m`);
      continue;
    }
  }

  console.warn('\x1b[33m[RootCause-AI] All model endpoints saturated. Activating deterministic heuristic fallback.\x1b[0m');
  return generateHeuristicFallback(context);
}