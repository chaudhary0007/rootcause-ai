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

async function callWithRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 2000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    if (retries > 0 && (error.status === 503 || error.status === 429)) {
      console.warn(`\x1b[33m[RootCause-AI] API busy (${error.status}). Retrying in ${delayMs / 1000}s... (${retries} retries left)\x1b[0m`);
      await new Promise((res) => setTimeout(res, delayMs));
      return callWithRetry(fn, retries - 1, delayMs * 2);
    }
    throw error;
  }
}

export async function runTriage(context: EnrichedContext): Promise<TriageResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is missing. Set it in your .env file.');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-3.8-flash',
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    },
  });

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

  const response = await callWithRetry(() => model.generateContent(prompt));
  const responseText = response.response.text();

  try {
    const parsedJson = JSON.parse(responseText);
    return TriageResultSchema.parse(parsedJson);
  } catch (err) {
    console.error('Failed to parse or validate Gemini output. Raw response:', responseText);
    throw err;
  }
}