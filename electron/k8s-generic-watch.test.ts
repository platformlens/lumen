import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface Call { params: Record<string, string>; cb: (type: string, obj: unknown) => void; done: (err: unknown) => void }
const calls = vi.hoisted(() => [] as Array<{ params: Record<string, string>; cb: (type: string, obj: unknown) => void; done: (err: unknown) => void }>);

vi.mock('@kubernetes/client-node', () => {
  class KubeConfig {
    loadFromDefault() {}
    loadFromFile() {}
    getContexts() { return [{ name: 'ctx', cluster: 'c', user: 'u' }]; }
    getContextObject() { return { name: 'ctx' }; }
    setCurrentContext() {}
    makeApiClient() { return {}; }
  }
  class Watch {
    watch(_path: string, params: Record<string, string>, cb: Call['cb'], done: Call['done']) {
      calls.push({ params, cb, done });
      return Promise.resolve(new AbortController());
    }
  }
  const Api = class {};
  return {
    KubeConfig, Watch, AppsV1Api: Api, CoreV1Api: Api, RbacAuthorizationV1Api: Api, ApiextensionsV1Api: Api,
    CustomObjectsApi: Api, BatchV1Api: Api, NetworkingV1Api: Api, StorageV1Api: Api, DiscoveryV1Api: Api,
    PortForward: Api, Log: Api, AutoscalingV2Api: Api, PolicyV1Api: Api, AdmissionregistrationV1Api: Api,
    SchedulingV1Api: Api, NodeV1Api: Api,
  };
});

vi.mock('./kubeconfig-files', () => ({
  resolveKubeconfigFiles: () => [],
  resolveCustomKubeconfigPath: () => undefined,
  hashKubeconfigFiles: () => 'h',
  contextsSignature: () => 'sig',
  renameContextInFiles: () => undefined,
}));

import { K8sService } from './k8s';

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('K8sService generic watch keys', () => {
  beforeEach(() => {
    calls.length = 0;
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('an internal reconnect keeps the resourceVersion', async () => {
    const svc = new K8sService();
    const onEvent = vi.fn();
    await svc.startGenericWatch('ctx', 'daemonsets@ctx#1', '/apis/apps/v1/daemonsets', onEvent);
    calls[0].cb('ADDED', { metadata: { name: 'a', resourceVersion: '42' } });
    expect(onEvent).toHaveBeenCalledTimes(1);
    calls[0].done(null); // normal close
    vi.advanceTimersByTime(500);
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1].params.resourceVersion).toBe('42');
    svc.disposeGenericWatch('daemonsets@ctx#1');
  });

  it('disposeGenericWatch removes the key from all maps and drops late callbacks', async () => {
    const svc = new K8sService();
    const onEvent = vi.fn();
    const before = svc.getLegacyMapSizes();
    await svc.startGenericWatch('ctx', 'daemonsets@ctx#2', '/apis/apps/v1/daemonsets', onEvent);
    calls[0].cb('ADDED', { metadata: { name: 'a', resourceVersion: '7' } });
    expect(svc.getLegacyMapSizes().watchGenerations).toBe(before.watchGenerations + 1);
    svc.disposeGenericWatch('daemonsets@ctx#2');
    expect(svc.getLegacyMapSizes()).toEqual(before);
    calls[0].cb('ADDED', { metadata: { name: 'late', resourceVersion: '8' } });
    calls[0].done(new Error('late'));
    vi.advanceTimersByTime(60_000);
    await flush();
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(svc.getLegacyMapSizes()).toEqual(before);
  });
});
