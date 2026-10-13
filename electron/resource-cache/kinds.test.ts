import { describe, it, expect } from 'vitest';
import {
  CORE_KIND_DESCRIPTORS,
  LAST_APPLIED_ANNOTATION,
  extractStatusCode,
  itemId,
  mapStatusToMessage,
  toWireShape,
  trimConfigMap,
  trimDeployment,
  trimSecret,
  trimService,
} from './kinds';

const SENTINEL = 'c2VjcmV0LXNlbnRpbmVsLXZhbHVl';

function meta(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'uid-1',
    name: 'obj',
    namespace: 'ns1',
    resourceVersion: '42',
    creationTimestamp: '2024-01-02T03:04:05.000Z',
    labels: { app: 'a' },
    annotations: { keep: 'yes', [LAST_APPLIED_ANNOTATION]: `{"data":{"k":"${SENTINEL}"}}` },
    managedFields: [{ manager: 'kubectl', fieldsV1: { f: SENTINEL } }],
    generation: 3,
    ...overrides,
  };
}

function typedMeta() {
  const m = meta();
  return { ...m, creationTimestamp: new Date(m.creationTimestamp) };
}

const deepContains = (v: unknown, needle: string): boolean => JSON.stringify(v).includes(needle);

function allStrings(v: unknown, path = ''): string[] {
  if (v instanceof Date) return [path];
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => allStrings(x, `${path}.${k}`));
  return [];
}

describe('trimmers', () => {
  it('drop managedFields and the last-applied annotation for every kind', () => {
    const raw = { metadata: meta(), spec: {}, status: {}, data: {}, type: 'Opaque' };
    for (const trim of [trimDeployment, trimService, trimConfigMap, trimSecret]) {
      const out = trim(raw) as unknown as { metadata: Record<string, unknown> };
      expect(out.metadata).not.toHaveProperty('managedFields');
      expect(out.metadata).not.toHaveProperty('generation');
      expect(out.metadata.annotations).toEqual({ keep: 'yes' });
      expect(deepContains(out, SENTINEL)).toBe(false);
    }
  });

  it('never include Secret or ConfigMap values', () => {
    const secret = trimSecret({ metadata: meta(), type: 'Opaque', data: { a: SENTINEL, b: SENTINEL } });
    expect(secret.data).toBe(2);
    expect(deepContains(secret, SENTINEL)).toBe(false);
    const cm = trimConfigMap({ metadata: meta(), data: { a: SENTINEL }, binaryData: { b: SENTINEL } });
    expect(cm.data).toBe(2);
    expect(deepContains(cm, SENTINEL)).toBe(false);
  });

  it('id falls back to namespace/name without a uid', () => {
    expect(itemId({ metadata: { name: 'n', namespace: 'ns' } })).toBe('ns/n');
    expect(itemId({ metadata: { uid: 'u', name: 'n', namespace: 'ns' } })).toBe('u');
    expect(trimSecret({ metadata: { name: 'n', namespace: 'ns' } }).id).toBe('ns/n');
  });

  it('typed LIST objects through toWireShape equal raw WATCH objects', () => {
    const cases: Array<[(r: unknown) => unknown, Record<string, unknown>]> = [
      [trimDeployment, { spec: { replicas: 3, selector: { matchLabels: { app: 'a' } } }, status: { availableReplicas: 2, conditions: [{ type: 'Available', lastUpdateTime: '2024-01-02T03:04:05.000Z' }] } }],
      [trimSecret, { type: 'Opaque', data: { a: SENTINEL } }],
      [trimConfigMap, { data: { a: 'b' } }],
      [trimService, { spec: { type: 'ClusterIP', clusterIP: '10.0.0.1', ports: [{ port: 80, targetPort: 8080, protocol: 'TCP' }] } }],
    ];
    for (const [trim, body] of cases) {
      const raw = { metadata: meta(), ...body };
      const typedBody = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
      const status = typedBody.status as { conditions?: Array<Record<string, unknown>> } | undefined;
      if (status?.conditions) status.conditions[0].lastUpdateTime = new Date('2024-01-02T03:04:05.000Z');
      const typed = { metadata: typedMeta(), ...typedBody };
      const a = trim(toWireShape(typed));
      const b = trim(raw);
      expect(a).toEqual(b);
      expect(allStrings(a)).toEqual([]);
      expect(typeof (a as { age: unknown }).age).toBe('string');
    }
  });

  it('service ports format matches getServices', () => {
    const svc = trimService({ metadata: meta(), spec: { ports: [{ port: 80, targetPort: 8080, protocol: 'TCP' }, { port: 443, targetPort: 'https', protocol: 'TCP' }] } });
    expect(svc.ports).toBe('80:8080/TCP, 443:https/TCP');
  });
});

describe('error classification', () => {
  it('extractStatusCode only returns numeric codes', () => {
    expect(extractStatusCode({ name: 'FetchError', code: 'ECONNRESET' })).toBeUndefined();
    expect(extractStatusCode({ statusCode: 401 })).toBe(401);
    expect(extractStatusCode({ code: 401 })).toBe(401);
    expect(extractStatusCode({ body: { code: 401 } })).toBe(401);
    expect(extractStatusCode(null)).toBeUndefined();
  });

  it('mapStatusToMessage never echoes the input', () => {
    const leak = 'Bearer abc.def /Users/me/.kube/config';
    const errs = [
      { statusCode: 401, message: leak, body: { message: leak } },
      { code: 403, message: leak },
      { code: 404, message: leak },
      { code: 503, message: leak },
      { name: 'FetchError', code: 'ECONNRESET', message: leak },
      new Error(leak),
    ];
    const out = errs.map((e) => mapStatusToMessage(e, 'secrets'));
    expect(out).toEqual([
      'Authentication failed: refresh credentials',
      'No permission to list Secrets',
      'Resource type not served by cluster',
      'Cluster API error (503)',
      'Cannot reach cluster API',
      'Unexpected error',
    ]);
    for (const m of out) expect(m).not.toContain('Bearer');
  });
});

describe('descriptors', () => {
  it('page sizes: secrets 100, others 500', () => {
    expect(CORE_KIND_DESCRIPTORS.secrets.pageSize).toBe(100);
    expect(CORE_KIND_DESCRIPTORS.deployments.pageSize).toBe(500);
    expect(CORE_KIND_DESCRIPTORS.services.pageSize).toBe(500);
    expect(CORE_KIND_DESCRIPTORS.configmaps.pageSize).toBe(500);
  });

  it('watch paths per scope', () => {
    expect(CORE_KIND_DESCRIPTORS.deployments.watchPath('*')).toBe('/apis/apps/v1/deployments');
    expect(CORE_KIND_DESCRIPTORS.secrets.watchPath('ns1')).toBe('/api/v1/namespaces/ns1/secrets');
  });
});
