import { getEnrichedContext } from './core/enricher';
import { runTriage } from './core/triageEngine';

async function main() {
  console.log('\x1b[36m%s\x1b[0m', '🔍 [RootCause-AI] Loading failure telemetry and git context...');

  const context = getEnrichedContext();
  if (!context) {
    console.log('\x1b[33m%s\x1b[0m', 'ℹ No failure artifacts found in .rootcause/failures.json. Suite passed cleanly!');
    process.exit(0);
  }

  console.log(`📡 Analyzing ${context.failures.length} failing test(s) via Gemini 3.8 Flash...`);
  const startTime = Date.now();

  try {
    const result = await runTriage(context);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n================ ROOT-CAUSE ANALYSIS REPORT ================');
    console.log(`🏷️  Category:       \x1b[35m${result.category}\x1b[0m (Confidence: ${(result.confidenceScore * 100).toFixed(0)}%)`);
    console.log(`📌 Headline:       ${result.headline}`);
    console.log(`🎯 Culprit:        ${result.culprit.type} -> ${result.culprit.likelyFile}${result.culprit.likelyLine ? `:${result.culprit.likelyLine}` : ''}`);
    console.log(`⏱️  Triage Time:   ${duration}s`);
    console.log('------------------------------------------------------------');
    console.log('📖 Root Cause:');
    console.log(result.rootCauseAnalysis);
    console.log('------------------------------------------------------------');
    console.log('🛠️  Suggested Fix:');
    console.log(result.suggestedFix.explanation);
    if (result.suggestedFix.codePatch) {
      console.log('\nProposed Patch:\n' + result.suggestedFix.codePatch);
    }
    console.log('============================================================\n');
  } catch (error: any) {
    console.error('❌ Triage execution failed:', error.message || error);
    if (error.cause) {
      console.error('🔍 Root Cause Detail:', error.cause);
    }
    process.exit(1);
  }
}

main();