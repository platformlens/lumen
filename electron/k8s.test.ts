import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  loadThrows: null as Error | null,
  contexts: ['ctx-a'] as string[],
}));

vi.mock('@kubernetes/client-node', () => {
  class KubeConfig {
    current = '';
    loadFromDefault() { if (state.loadThrows) throw state.loadThrows; }
    loadFromFile() { if (state.loadThrows) throw state.loadThrows; }
    getContexts() { return state.contexts.map((name) => ({ name, cluster: name, user: name })); }
    getContextObject(name: string) { return state.contexts.includes(name) ? { name } : null; }
    setCurrentContext(name: string) { this.current = name; }
    getCurrentContext() { return this.current; }
    makeApiClient() { return {}; }
  }
  class Watch { watch() { return Promise.resolve(new AbortController()); } }
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
import { KubeconfigLoadError, UnknownContextError } from './resource-cache/kinds';

describe('K8sService.createKubeConfig', () => {
  beforeEach(() => {
    state.loadThrows = null;
    state.contexts = ['ctx-a'];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns a fresh config set to the requested context', () => {
    const svc = new K8sService();
    const a = svc.createKubeConfig('ctx-a');
    const b = svc.createKubeConfig('ctx-a');
    expect(a).not.toBe(b);
    expect(a.getCurrentContext()).toBe('ctx-a');
  });

  it('wraps load failures as KubeconfigLoadError without leaking the cause', () => {
    const svc = new K8sService();
    state.loadThrows = new Error('bad YAML at /Users/secret/.kube/config: token=abc');
    let caught: unknown;
    try { svc.createKubeConfig('ctx-a'); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(KubeconfigLoadError);
    expect((caught as Error).message).toBe('Failed to load kubeconfig');
    expect((caught as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(JSON.stringify(caught) + String(caught)).not.toContain('secret');
  });

  it('throws UnknownContextError for a missing context', () => {
    const svc = new K8sService();
    expect(() => svc.createKubeConfig('nope')).toThrow(UnknownContextError);
  });
});
