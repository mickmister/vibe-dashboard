import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';

let sdk: NodeSDK | undefined;
let shutdownHookInstalled = false;

export function startVdOtel(env: Record<string, string | undefined> = process.env): { started: boolean; exporter?: 'console' | 'otlp'; reason?: string } {
  if (sdk) return { started: true, exporter: exporterKind(env) };
  if (!isVdOtelEnabled(env)) return { started: false, reason: 'disabled' };

  const exporter = createTraceExporter(env);
  sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME || 'vibe-dashboard',
    traceExporter: exporter.kind === 'console' ? new ConsoleSpanExporter() : new OTLPTraceExporter(),
  });
  sdk.start();
  installShutdownHook();
  return { started: true, exporter: exporter.kind };
}

export function isVdOtelEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.VD_OTEL_ENABLED === 'true' || Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT || env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT);
}

function createTraceExporter(env: Record<string, string | undefined>): { kind: 'console' | 'otlp' } {
  return { kind: exporterKind(env) };
}

function exporterKind(env: Record<string, string | undefined>): 'console' | 'otlp' {
  if (env.VD_OTEL_TRACES_EXPORTER === 'console') return 'console';
  return 'otlp';
}

function installShutdownHook(): void {
  if (shutdownHookInstalled) return;
  shutdownHookInstalled = true;
  process.once('beforeExit', () => {
    void sdk?.shutdown().catch(() => undefined);
  });
}
