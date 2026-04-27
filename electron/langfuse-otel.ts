/**
 * OpenTelemetry + Langfuse span export. Requires LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY.
 * Optional: LANGFUSE_BASE_URL (default https://cloud.langfuse.com), LANGFUSE_TRACING_ENVIRONMENT.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';

let sdk: NodeSDK | null = null;

export function initLangfuseOtel(): void {
  if (sdk) return;
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    return;
  }
  sdk = new NodeSDK({
    spanProcessors: [new LangfuseSpanProcessor()],
  });
  sdk.start();
}

export function isLangfuseOtelConfigured(): boolean {
  return !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

export async function shutdownLangfuseOtel(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } finally {
    sdk = null;
  }
}
