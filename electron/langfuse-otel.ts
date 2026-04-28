/**
 * OpenTelemetry + Langfuse span export. Requires LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY.
 * User preference (Settings → AI) can disable the SDK; LANGFUSE_TRACING_DISABLE in env also disables.
 * Optional: LANGFUSE_BASE_URL (default https://cloud.langfuse.com), LANGFUSE_TRACING_ENVIRONMENT.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';

let sdk: NodeSDK | null = null;

/** Set from main after electron-store exists: () => true if user allows trace analytics, false to opt out. */
let userTraceAnalyticsAllowed: (() => boolean) | null = null;

export function setLangfuseTraceAnalyticsPreferenceReader(fn: () => boolean): void {
  userTraceAnalyticsAllowed = fn;
}

function tracingDisabledByEnv(): boolean {
  return process.env.LANGFUSE_TRACING_DISABLE === '1' || process.env.LANGFUSE_TRACING_DISABLE === 'true';
}

function canUseLangfuseKeys(): boolean {
  return !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

function userAllowsTracing(): boolean {
  if (!userTraceAnalyticsAllowed) return true;
  return userTraceAnalyticsAllowed();
}

/** Whether we should have the NodeSDK running (keys + env + in-app setting). */
export function shouldRunLangfuseOtel(): boolean {
  if (tracingDisabledByEnv()) return false;
  if (!canUseLangfuseKeys()) return false;
  if (!userAllowsTracing()) return false;
  return true;
}

/**
 * Start OTEL if conditions allow, or shutdown if not. Call after user preference is registered and when the toggle changes.
 */
export function syncLangfuseOtelWithStore(): void {
  if (!shouldRunLangfuseOtel()) {
    void shutdownLangfuseOtel();
    return;
  }
  if (sdk) return;
  try {
    sdk = new NodeSDK({
      spanProcessors: [new LangfuseSpanProcessor()],
    });
    sdk.start();
  } catch (e) {
    console.error('[Langfuse] Failed to start OpenTelemetry SDK:', e);
  }
}

export function isLangfuseOtelConfigured(): boolean {
  return canUseLangfuseKeys();
}

export function isLangfuseTracingEnabled(): boolean {
  return shouldRunLangfuseOtel() && sdk !== null;
}

export async function shutdownLangfuseOtel(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch (e) {
    console.error('[Langfuse] OTEL shutdown error:', e);
  } finally {
    sdk = null;
  }
}
