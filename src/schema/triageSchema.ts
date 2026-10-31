import { z } from 'zod';

export const FailureCategoryEnum = z.enum([
  'PRODUCT_REGRESSION', // The application code broke existing business logic
  'LOCATOR_CHURN',     // UI DOM changed (renamed IDs, altered classes, stripped data-test)
  'FLAKY_ENVIRONMENT', // Network timeouts, 504 Gateway errors, socket resets
  'TEST_DATA_DEFECT',  // Expired authentication tokens, missing test accounts/mocks
]);

export type FailureCategory = z.infer<typeof FailureCategoryEnum>;

export const TriageResultSchema = z.object({
  category: FailureCategoryEnum,
  confidenceScore: z.number().min(0).max(1).describe('Confidence rating between 0 and 1'),
  headline: z.string().describe('One crisp sentence summarizing the exact cause of failure'),
  culprit: z.object({
    type: z.enum(['APPLICATION_CODE', 'TEST_CODE', 'INFRASTRUCTURE']),
    likelyFile: z.string().describe('The primary file responsible for the regression or failure'),
    likelyLine: z.number().optional().describe('Estimated line number where the issue originated'),
  }),
  rootCauseAnalysis: z.string().describe('Detailed technical explanation linking the PR diff to the test failure'),
  suggestedFix: z.object({
    explanation: z.string().describe('How to resolve the issue'),
    codePatch: z.string().optional().describe('Unified diff format or code snippet showing the fix'),
  }),
});

export type TriageResult = z.infer<typeof TriageResultSchema>;