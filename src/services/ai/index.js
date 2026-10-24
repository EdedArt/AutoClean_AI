const env = require('../../config/env');
const AppError = require('../../utils/AppError');
const geminiProvider = require('./geminiProvider');
const simulatedProvider = require('./simulatedProvider');

let customProvider = null;

/**
 * Injects a custom provider for testing.
 *
 * @param {object|null} provider - Must implement analyzeImage(params)
 */
function setProvider(provider) {
  customProvider = provider;
}

/**
 * Resets custom provider back to default configuration.
 */
function resetProvider() {
  customProvider = null;
}

/**
 * Resolves effective provider name based on environment configuration and custom provider overrides.
 *
 * @returns {"gemini"|"simulated"}
 */
function resolveEffectiveProvider() {
  if (customProvider && customProvider.name) {
    return customProvider.name;
  }
  const mode = env.AI_MODE;
  if (mode === 'gemini') {
    return 'gemini';
  }
  if (mode === 'simulated') {
    return 'simulated';
  }
  // mode === 'auto'
  const hasKey = Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim() !== '');
  return hasKey ? 'gemini' : 'simulated';
}

/**
 * Returns current status of the AI subsystem.
 * IMPORTANT: NEVER exposes the API key or any portion thereof.
 */
function getAiStatus() {
  const effective = resolveEffectiveProvider();
  const model = effective === 'gemini'
    ? (env.GEMINI_MODEL || 'gemini-3.1-flash-lite')
    : 'simulated-deterministic';

  return {
    mode: env.AI_MODE,
    effectiveProvider: effective,
    model,
    keyConfigured: Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim() !== ''),
    fallbackEnabled: env.AI_FALLBACK_TO_SIMULATED,
    minConfidence: env.AI_MIN_CONFIDENCE,
  };
}

/**
 * Main AI entry point. Analyzes a vehicle image using Gemini or the deterministic simulated provider,
 * with automatic fallback logic when configured.
 *
 * @param {object} params
 * @param {Buffer} params.buffer
 * @param {string} [params.mimeType="image/jpeg"]
 * @param {string} params.expectedPlate
 * @param {string} [params.currentPhase="PENDIENTE"]
 * @param {number|string} [params.orderId=1]
 * @param {string} [params.scenario]
 * @returns {Promise<{
 *   provider: "gemini"|"simulated",
 *   model: string,
 *   result: {
 *     plateDetected: string|null,
 *     plateConfidence: number,
 *     phase: string,
 *     phaseConfidence: number,
 *     dirtLevel: string|null,
 *     notes: string
 *   },
 *   latencyMs: number,
 *   fallbackUsed: boolean
 * }>}
 */
async function analyze(params) {
  const startTime = Date.now();

  const effectiveProvider = customProvider?.name || resolveEffectiveProvider();
  const activeGeminiProvider = customProvider?.name === 'gemini' ? customProvider : geminiProvider;

  // If a mock or custom provider other than gemini is injected, use it directly
  if (customProvider && customProvider.name !== 'gemini') {
    const res = await customProvider.analyzeImage(params);
    if (res && res.observations && !res.phaseSource) {
      const { derivePhase } = require('./phaseRules');
      const derived = derivePhase(res.observations, res.phase, res.phaseConfidence);
      res.phase = derived.phase;
      res.phaseConfidence = derived.confidence;
      res.phaseSource = derived.source;
      res.phaseReason = derived.reason;
    }
    const latencyMs = Date.now() - startTime;
    return {
      provider: customProvider.name || 'simulated',
      model: customProvider.model || 'custom',
      result: res,
      latencyMs,
      fallbackUsed: Boolean(customProvider.fallbackUsed),
    };
  }

  if (effectiveProvider === 'gemini') {
    const model = customProvider?.model || env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
    try {
      const result = await activeGeminiProvider.analyzeImage(params);
      if (result && result.observations && !result.phaseSource) {
        const { derivePhase } = require('./phaseRules');
        const derived = derivePhase(result.observations, result.phase, result.phaseConfidence);
        result.phase = derived.phase;
        result.phaseConfidence = derived.confidence;
        result.phaseSource = derived.source;
        result.phaseReason = derived.reason;
      }
      const latencyMs = Date.now() - startTime;
      return {
        provider: 'gemini',
        model,
        result,
        latencyMs,
        fallbackUsed: false,
      };
    } catch (err) {
      console.warn(`[AI] Gemini provider error: ${err.message}`);

      if (env.AI_FALLBACK_TO_SIMULATED) {
        console.warn('[AI] Falling back to simulated provider due to Gemini failure.');
        const result = await simulatedProvider.analyzeImage(params);
        const latencyMs = Date.now() - startTime;
        return {
          provider: 'simulated',
          model: 'simulated-deterministic',
          result,
          latencyMs,
          fallbackUsed: true,
        };
      }

      // Fallback disabled: throw typed error
      const isQuota = err.isQuota || err.status === 429;
      if (isQuota) {
        throw new AppError(
          'AI service rate limit exceeded. Please retry in 60 seconds (Retry-After: 60).',
          503,
          'AI_RATE_LIMITED'
        );
      }

      throw new AppError(
        `AI vision service is temporarily unavailable: ${err.message}`,
        503,
        'AI_UNAVAILABLE'
      );
    }
  }

  // Simulated provider
  const result = await simulatedProvider.analyzeImage(params);
  const latencyMs = Date.now() - startTime;
  return {
    provider: 'simulated',
    model: 'simulated-deterministic',
    result,
    latencyMs,
    fallbackUsed: false,
  };
}

module.exports = {
  analyze,
  getAiStatus,
  resolveEffectiveProvider,
  setProvider,
  resetProvider,
  geminiProvider,
  simulatedProvider,
};
