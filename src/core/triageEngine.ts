import { GoogleGenerativeAI } from '@google/generative-ai';
import { TriageResult, TriageResultSchema } from '../schema/triageSchema';
import { EnrichedContext } from './enricher';
import * as dotenv from 'dotenv';

dotenv.config();

const SYSTEM_INSTRUCTION = `You are a Principal SDET and Root-Cause Analysis (RCA) expert.
Analyze Playwright test failures alongside the pull request's Git diff to determine why the test failed.

Categorize the failure into exactly ONE of:
1. "PRODUCT_REGRESSION"
2. "LOCATOR_CHURN"
3. "FLAKY_ENVIRONMENT"
4. "TEST_DATA_DEFECT"

Output MUST be valid JSON matching the requested structure.`;

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
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT'
  );
}

async function callWithRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 3000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    if (retries > 0 && isTransientError(error)) {
      const reason = error.status ? `HTTP ${error.status}` : error.cause?.message || error.message;
      console.warn(`\x1b[33m[RootCause-AI] API busy (${reason}). Retrying in ${delayMs / 1000}s... (${retries} left)\x1b[0m`);
      await new Promise((res) => setTimeout(res, delayMs));
      return callWithRetry(fn, retries - 1, delayMs * 2);
    }
    throw error;
  }
}

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
    rootCauseAnalysis: `[Offline Heuristic Triage] The test timed out interacting with target locator. Failure detail: ${errorMsg.slice(0, 200)}`,
    suggestedFix: {
      explanation: isLocatorChurn
        ? 'Update the test selector to match current DOM attributes, or verify whether the element has been renamed in recent commits.'
        : 'Check recent backend commits for functional regressions against the failed assertion.',
      codePatch: undefined,
    },
  };
}

export async function runTriage(context: EnrichedContext): Promise<TriageResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('\x1b[33m[RootCause-AI] GEMINI_API_KEY missing. Using heuristic fallback.\x1b[0m');
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
  "confidenceScore": number,
  "headline": string,
  "culprit": {
    "type": "APPLICATION_CODE" | "TEST_CODE" | "INFRASTRUCTURE",
    "likelyFile": string,
    "likelyLine": number
  },
  "rootCauseAnalysis": string,
  "suggestedFix": {
    "explanation": string,
    "codePatch": string
  }
}`;

  try {
    console.log('\x1b[36m[RootCause-AI] Dispatching triage request to gemini-3.8-flash...\x1b[0m');
    const model = genAI.getGenerativeModel({
      model: 'gemini-3.8-flash',
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    });

    const response = await callWithRetry(() => model.generateContent(prompt), 2, 3000);
    const responseText = response.response.text();
    return TriageResultSchema.parse(JSON.parse(responseText));
  } catch (error: any) {
    console.warn(`\x1b[33m[RootCause-AI] Gemini API unavailable (${error.status || error.message}). Activating deterministic heuristic fallback.\x1b[0m`);
    return generateHeuristicFallback(context);
  }
}