// OpenTelemetry SDK bootstrap.
//
// CRITICAL: this file must run BEFORE any module that we want to instrument
// (HTTP, fetch, DB drivers...). Achieve this via:
//
//     node --import ./src/tracing.ts src/index.ts
//
// `--import` is the ESM equivalent of the legacy `-r` (require) flag. It runs
// this module's top-level code as a side-effect before evaluating the entry
// point, which is when our instrumentations patch the global module loader.
//
// In tests we deliberately DON'T load this file: `trace.getTracer()` falls
// back to a no-op tracer, so `withSpan(...)` keeps working without any setup.

import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  type SpanExporter,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';

// Disabled if OTEL_SDK_DISABLED=true (the official env-var contract).
// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires brackets on process.env
if (process.env['OTEL_SDK_DISABLED'] !== 'true') {
  // biome-ignore lint/complexity/useLiteralKeys: idem
  const otlpEndpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];

  // Pick exporter by config:
  //   - OTLP HTTP if a collector endpoint is set (production target).
  //   - Console otherwise — dumps spans to stdout, zero infrastructure needed.
  const exporter: SpanExporter = otlpEndpoint
    ? new OTLPTraceExporter({ url: `${otlpEndpoint.replace(/\/$/, '')}/v1/traces` })
    : new ConsoleSpanExporter();

  // Batch in production (efficiency), immediate-flush in console mode
  // (so devs see spans live in the terminal).
  const spanProcessor: SpanProcessor = otlpEndpoint
    ? new BatchSpanProcessor(exporter)
    : new SimpleSpanProcessor(exporter);

  const sdk = new NodeSDK({
    // biome-ignore lint/complexity/useLiteralKeys: idem
    serviceName: process.env['OTEL_SERVICE_NAME'] ?? 'node-ts-starter-api',
    spanProcessors: [spanProcessor],
    instrumentations: [
      getNodeAutoInstrumentations({
        // Skip the noisiest auto-instrumentations: every fs.read and dns.lookup
        // would otherwise generate a span and flood the trace tree.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });

  sdk.start();

  const shutdown = async (): Promise<void> => {
    try {
      await sdk.shutdown();
    } catch {
      // Best-effort. Don't fail the process on shutdown errors.
    }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
