/** CrossplaneService wired to FakeCrossplaneApi instances with a controllable clock (tests only). */
import type { CrossplaneScanProgress } from '../../src/types/crossplane';
import { CrossplaneService } from '../crossplane';
import { FakeCrossplaneApi, crossplaneCluster } from './fake-crossplane-api';

export interface Harness {
    service: CrossplaneService;
    api: FakeCrossplaneApi;
    apis: Map<string, FakeCrossplaneApi>;
    factoryCalls: string[];
    progress: CrossplaneScanProgress[];
    advance: (ms: number) => void;
    now: () => number;
}

export function harness(api: FakeCrossplaneApi = crossplaneCluster(), build: (ctx: string) => FakeCrossplaneApi = ctx => crossplaneCluster(new FakeCrossplaneApi(ctx))): Harness {
    let t = Date.parse('2024-06-01T00:00:00Z');
    const apis = new Map<string, FakeCrossplaneApi>([[api.context, api]]);
    const factoryCalls: string[] = [];
    const progress: CrossplaneScanProgress[] = [];
    const now = () => t;
    const service = new CrossplaneService({
        kubeConfigFactory: () => { throw new Error('not used in tests'); },
        emitProgress: p => { progress.push(p); },
        apiFactory: ctx => {
            factoryCalls.push(ctx);
            let a = apis.get(ctx);
            if (!a) { a = build(ctx); apis.set(ctx, a); }
            return a;
        },
        now,
    });
    return { service, api, apis, factoryCalls, progress, now, advance: ms => { t += ms; } };
}

/** Promise that resolves when `open()` is called. */
export function gate(): { promise: Promise<void>; open: () => void } {
    let open = () => undefined as void;
    const promise = new Promise<void>(r => { open = r; });
    return { promise, open };
}
