import { describe, it, expect } from 'vitest';
import {
    resolveEffectiveSecurityContext, evaluateRunAsRoot, evaluateAddedCapability, computePssLevel,
    evaluateSecurityPosture, type SecurityCheck,
} from './security-posture-utils';
import type { PodTemplate } from '../types/deployment-details';

type Spec = NonNullable<PodTemplate['spec']>;
type Container = Spec['containers'][number];

const tpl = (spec: Partial<Spec>, annotations?: Record<string, string>): PodTemplate => ({
    metadata: annotations ? { annotations } : {},
    spec: { containers: [{ name: 'app', image: 'nginx:1' }], ...spec },
});
const restrictedContainer: Container = {
    name: 'app', image: 'nginx:1',
    securityContext: {
        runAsUser: 1000, runAsGroup: 1000, runAsNonRoot: true, allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] }, seccompProfile: { type: 'RuntimeDefault' },
    },
};
const effFor = (sc: Container['securityContext'], podSc?: Spec['securityContext']) => {
    const t = tpl({ securityContext: podSc, containers: [{ name: 'app', securityContext: sc }] });
    return resolveEffectiveSecurityContext(t, t.spec!.containers[0], 'main');
};
const find = (checks: SecurityCheck[], id: string, container: string | null = 'app') =>
    checks.find(c => c.id === id && c.container === container);

describe('evaluateRunAsRoot truth table', () => {
    it('row 1: uid 0 + runAsNonRoot true -> fail (pod will not start)', () => {
        const c = evaluateRunAsRoot(effFor({ runAsUser: 0, runAsNonRoot: true }));
        expect(c).toMatchObject({ level: 'fail', pss: 'restricted', pssViolation: true,
            title: 'Pod will fail to start: runAsNonRoot=true with runAsUser=0' });
    });
    it('row 2: uid 0 + runAsNonRoot unset or false -> fail (runs as root)', () => {
        for (const sc of [{ runAsUser: 0 }, { runAsUser: 0, runAsNonRoot: false }]) {
            expect(evaluateRunAsRoot(effFor(sc))).toMatchObject({ level: 'fail', pssViolation: true, title: 'Runs as root (runAsUser=0)' });
        }
    });
    it('row 3: uid > 0 + runAsNonRoot true -> pass', () => {
        expect(evaluateRunAsRoot(effFor({ runAsUser: 1000, runAsNonRoot: true })))
            .toMatchObject({ level: 'pass', pssViolation: false, title: 'Runs as non-root uid 1000' });
    });
    it('row 4: uid 1000 + runAsNonRoot unset -> pass with a Restricted violation', () => {
        expect(evaluateRunAsRoot(effFor({ runAsUser: 1000 }))).toMatchObject({ level: 'pass', pss: 'restricted', pssViolation: true,
            title: 'Runs as uid 1000; runAsNonRoot not set (Restricted requires it)' });
    });
    it('row 5: uid unset + runAsNonRoot true -> pass (kubelet enforced)', () => {
        expect(evaluateRunAsRoot(effFor({ runAsNonRoot: true }))).toMatchObject({ level: 'pass', pssViolation: false,
            title: 'Non-root enforced by kubelet (image USER must be numeric, non-zero)' });
    });
    it('row 6: uid unset + runAsNonRoot unset -> warn', () => {
        expect(evaluateRunAsRoot(effFor({}))).toMatchObject({ level: 'warn', pssViolation: true, title: 'May run as root (depends on image USER)' });
    });
    it('treats explicit runAsNonRoot:false like unset and notes it in the detail', () => {
        const c = evaluateRunAsRoot(effFor({ runAsNonRoot: false }));
        expect(c).toMatchObject({ level: 'warn', title: 'May run as root (depends on image USER)' });
        expect(c.detail).toContain('explicitly false');
        expect(evaluateRunAsRoot(effFor({ runAsUser: 5, runAsNonRoot: false })).pssViolation).toBe(true);
    });
});

describe('resolveEffectiveSecurityContext', () => {
    it('container overrides pod and records the source', () => {
        const eff = effFor({ runAsUser: 2000, seccompProfile: { type: 'Localhost' } },
            { runAsUser: 1000, runAsNonRoot: true, seccompProfile: { type: 'RuntimeDefault' }, runAsGroup: 3000 });
        expect(eff.runAsUser).toEqual({ value: 2000, source: 'container' });
        expect(eff.runAsNonRoot).toEqual({ value: true, source: 'pod' });
        expect(eff.runAsGroup).toEqual({ value: 3000, source: 'pod' });
        expect(eff.seccompProfile).toEqual({ value: 'Localhost', source: 'container' });
        expect(eff.seLinuxOptions).toEqual({ value: null, source: 'unset' });
    });
    it('normalizes capability names', () => {
        const eff = effFor({ capabilities: { add: ['cap_net_admin', 'chown'], drop: ['all'] } });
        expect(eff.capabilitiesAdd).toEqual(['NET_ADMIN', 'CHOWN']);
        expect(eff.capabilitiesDrop).toEqual(['ALL']);
    });
    it('falls back to the AppArmor annotation', () => {
        const t = tpl({}, { 'container.apparmor.security.beta.kubernetes.io/app': 'runtime/default' });
        expect(resolveEffectiveSecurityContext(t, t.spec!.containers[0], 'main').appArmorProfile)
            .toEqual({ value: 'RuntimeDefault', source: 'annotation' });
    });
    it('collects host ports', () => {
        const t = tpl({ containers: [{ name: 'app', ports: [{ containerPort: 80, hostPort: 8080 }, { containerPort: 81 }] }] });
        expect(resolveEffectiveSecurityContext(t, t.spec!.containers[0], 'main').hostPorts).toEqual([8080]);
    });
});

describe('evaluateAddedCapability', () => {
    it('classifies caps', () => {
        expect(evaluateAddedCapability('app', 'SYS_ADMIN')).toMatchObject({ level: 'fail', pss: 'baseline', pssViolation: true });
        expect(evaluateAddedCapability('app', 'ALL')).toMatchObject({ level: 'fail', pss: 'baseline' });
        expect(evaluateAddedCapability('app', 'NET_RAW')).toMatchObject({ level: 'warn', pss: 'baseline', pssViolation: true });
        expect(evaluateAddedCapability('app', 'CHOWN')).toMatchObject({ level: 'warn', pss: 'restricted', pssViolation: true });
        expect(evaluateAddedCapability('app', 'NET_BIND_SERVICE')).toMatchObject({ level: 'pass', pss: 'restricted', pssViolation: false });
        expect(evaluateAddedCapability('app', 'cap_net_admin')).toMatchObject({ level: 'fail', detail: 'capabilities.add includes NET_ADMIN' });
    });
});

describe('computePssLevel', () => {
    const chk = (pss: SecurityCheck['pss'], pssViolation: boolean, level: SecurityCheck['level'] = 'pass'): SecurityCheck =>
        ({ id: 'x', level, scope: 'pod', container: null, title: '', detail: '', pss, pssViolation });
    it('uses pssViolation only', () => {
        expect(computePssLevel([chk('restricted', true, 'pass')])).toBe('baseline');
        expect(computePssLevel([chk('baseline', true), chk('restricted', true)])).toBe('privileged');
        expect(computePssLevel([chk('baseline', false, 'fail'), chk(null, true)])).toBe('restricted');
    });
});

describe('evaluateSecurityPosture', () => {
    it('a fully restricted template -> restricted', () => {
        const r = evaluateSecurityPosture(tpl({ containers: [restrictedContainer], automountServiceAccountToken: false }));
        expect(r.pssLevel).toBe('restricted');
        expect(r.checks.filter(c => c.level === 'fail')).toEqual([]);
    });
    it('privileged -> privileged', () => {
        const c = { ...restrictedContainer, securityContext: { ...restrictedContainer.securityContext, privileged: true } };
        const r = evaluateSecurityPosture(tpl({ containers: [c] }));
        expect(r.pssLevel).toBe('privileged');
        expect(find(r.checks, 'privileged')?.level).toBe('fail');
        expect(find(r.checks, 'allow-privilege-escalation')?.level).toBe('fail');
    });
    it('CHOWN added -> warn, baseline level; NET_RAW -> privileged level', () => {
        const withCap = (cap: string) => tpl({ containers: [{ ...restrictedContainer,
            securityContext: { ...restrictedContainer.securityContext, capabilities: { drop: ['ALL'], add: [cap] } } }] });
        const chown = evaluateSecurityPosture(withCap('CHOWN'));
        expect(find(chown.checks, 'capabilities-add')?.level).toBe('warn');
        expect(chown.pssLevel).toBe('baseline');
        expect(evaluateSecurityPosture(withCap('NET_RAW')).pssLevel).toBe('privileged');
        expect(evaluateSecurityPosture(withCap('NET_BIND_SERVICE')).pssLevel).toBe('restricted');
        expect(find(evaluateSecurityPosture(withCap('SYS_ADMIN')).checks, 'capabilities-add')?.level).toBe('fail');
    });
    it('no caps added yields a single pass check', () => {
        const caps = evaluateSecurityPosture(tpl({ containers: [restrictedContainer] })).checks.filter(c => c.id === 'capabilities-add');
        expect(caps).toHaveLength(1);
        expect(caps[0]).toMatchObject({ level: 'pass', pss: null, title: 'No capabilities added' });
    });
    it('AppArmor Unconfined from the annotation -> fail', () => {
        const r = evaluateSecurityPosture(tpl({ containers: [restrictedContainer] },
            { 'container.apparmor.security.beta.kubernetes.io/app': 'unconfined' }));
        expect(find(r.checks, 'apparmor')).toMatchObject({ level: 'fail', pssViolation: true });
        expect(r.pssLevel).toBe('privileged');
    });
    it('SELinux type spc_t -> fail; container_t -> pass', () => {
        expect(find(evaluateSecurityPosture(tpl({ securityContext: { seLinuxOptions: { type: 'spc_t' } } })).checks, 'selinux')?.level).toBe('fail');
        expect(find(evaluateSecurityPosture(tpl({ securityContext: { seLinuxOptions: { type: 'container_t' } } })).checks, 'selinux')?.level).toBe('pass');
        expect(find(evaluateSecurityPosture(tpl({ securityContext: { seLinuxOptions: { user: 'u' } } })).checks, 'selinux')?.level).toBe('fail');
    });
    it('seccomp Unconfined -> fail/baseline; unset -> warn/restricted', () => {
        expect(find(evaluateSecurityPosture(tpl({ securityContext: { seccompProfile: { type: 'Unconfined' } } })).checks, 'seccomp'))
            .toMatchObject({ level: 'fail', pss: 'baseline' });
        expect(find(evaluateSecurityPosture(tpl({})).checks, 'seccomp')).toMatchObject({ level: 'warn', pss: 'restricted', pssViolation: true });
    });
    it('unsafe sysctl -> fail; safe sysctl -> pass', () => {
        const unsafe = evaluateSecurityPosture(tpl({ securityContext: { sysctls: [{ name: 'kernel.msgmax', value: '1' }] } }));
        expect(find(unsafe.checks, 'sysctls', null)).toMatchObject({ level: 'fail', pss: 'baseline', pssViolation: true });
        const safe = evaluateSecurityPosture(tpl({ securityContext: { sysctls: [{ name: 'net.ipv4.tcp_syncookies', value: '1' }] } }));
        expect(find(safe.checks, 'sysctls', null)?.level).toBe('pass');
    });
    it('nfs volume -> restricted violation; hostPath -> fail', () => {
        const nfs = evaluateSecurityPosture(tpl({ containers: [restrictedContainer], volumes: [{ name: 'data', nfs: { server: 's', path: '/x' } }] }));
        expect(find(nfs.checks, 'volume-types', null)).toMatchObject({ level: 'warn', pss: 'restricted', pssViolation: true });
        expect(nfs.pssLevel).toBe('baseline');
        const hp = evaluateSecurityPosture(tpl({ volumes: [{ name: 'host', hostPath: { path: '/var/run/docker.sock' } }] }));
        expect(find(hp.checks, 'host-path', null)).toMatchObject({ level: 'fail', pssViolation: true });
        expect(find(hp.checks, 'host-path', null)?.detail).toContain('/var/run/docker.sock');
        expect(find(hp.checks, 'volume-types', null)?.level).toBe('pass');
    });
    it('host namespaces and procMount', () => {
        const r = evaluateSecurityPosture(tpl({ hostNetwork: true, containers: [{ name: 'app', securityContext: { procMount: 'Unmasked' } }] }));
        expect(find(r.checks, 'host-network', null)?.level).toBe('fail');
        expect(find(r.checks, 'host-pid', null)?.level).toBe('pass');
        expect(find(r.checks, 'proc-mount')?.level).toBe('fail');
    });
    it('detects sidecars and evaluates them', () => {
        const r = evaluateSecurityPosture(tpl({ initContainers: [
            { name: 'proxy', restartPolicy: 'Always', securityContext: { privileged: true } },
            { name: 'migrate' },
        ] }));
        expect(r.containers.map(c => [c.container, c.kind])).toEqual([['proxy', 'sidecar'], ['migrate', 'init'], ['app', 'main']]);
        expect(find(r.checks, 'privileged', 'proxy')?.level).toBe('fail');
    });
    it('automount: pod setting overrides the SA', () => {
        const sa = { name: 'web', exists: true, automountServiceAccountToken: false, imagePullSecretNames: ['reg'], irsaRoleArn: 'arn:aws:iam::1:role/x' };
        const podTrue = evaluateSecurityPosture(tpl({ automountServiceAccountToken: true, serviceAccountName: 'web' }), { serviceAccount: sa });
        expect(find(podTrue.checks, 'automount-sa-token', null)?.level).toBe('warn');
        const saOnly = evaluateSecurityPosture(tpl({ serviceAccountName: 'web' }), { serviceAccount: sa });
        expect(find(saOnly.checks, 'automount-sa-token', null)?.level).toBe('pass');
        expect(find(saOnly.checks, 'irsa', null)?.detail).toBe('arn:aws:iam::1:role/x');
        expect(find(saOnly.checks, 'image-pull-secrets', null)?.detail).toContain('reg');
        expect(find(saOnly.checks, 'service-account', null)?.title).toBe('Service account web');
        expect(find(evaluateSecurityPosture(tpl({})).checks, 'service-account', null)?.detail).toContain('namespace default SA');
        expect(find(evaluateSecurityPosture(tpl({})).checks, 'irsa', null)).toBeUndefined();
    });
    it('counts tally every check level', () => {
        const r = evaluateSecurityPosture(tpl({}));
        const total = r.counts.pass + r.counts.warn + r.counts.fail + r.counts.info;
        expect(total).toBe(r.checks.length);
        expect(r.counts.info).toBe(r.checks.filter(c => c.level === 'info').length);
        expect(r.counts.warn).toBe(r.checks.filter(c => c.level === 'warn').length);
    });
});
