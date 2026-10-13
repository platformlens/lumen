/**
 * Security posture of a pod template: effective security contexts (container over pod),
 * per-check results and an approximate Pod Security Standards level.
 */
import type { V1Container } from '@kubernetes/client-node';
import type { Jsonified, PodTemplate, ServiceAccountSummary } from '../types/deployment-details';
import { volumeTypeOf } from './container-insights-utils';

export type CheckLevel = 'pass' | 'warn' | 'fail' | 'info';
export type ValueSource = 'container' | 'pod' | 'unset';
export type PssProfile = 'baseline' | 'restricted';
export interface EffectiveContainerSecurity {
    container: string; kind: 'init' | 'sidecar' | 'main';
    runAsUser: { value: number | null; source: ValueSource };
    runAsGroup: { value: number | null; source: ValueSource };
    runAsNonRoot: { value: boolean | null; source: ValueSource };
    seccompProfile: { value: string | null; source: ValueSource };     // RuntimeDefault | Localhost | Unconfined
    appArmorProfile: { value: string | null; source: ValueSource | 'annotation' };  // RuntimeDefault | Localhost | Unconfined
    seLinuxOptions: { value: { type?: string; user?: string; role?: string; level?: string } | null; source: ValueSource };
    privileged: boolean; allowPrivilegeEscalation: boolean | null; readOnlyRootFilesystem: boolean;
    capabilitiesAdd: string[]; capabilitiesDrop: string[]; procMount: string | null; hostPorts: number[];
}
export interface SecurityCheck {
    id: string; level: CheckLevel; scope: 'pod' | 'container'; container: string | null;
    title: string; detail: string;
    pss: PssProfile | null;   // the PSS profile whose control this check maps to (null = not a PSS control)
    pssViolation: boolean;    // true when the evaluated value violates that profile; sole input to pssLevel
}
export interface SecurityPostureReport {
    containers: EffectiveContainerSecurity[]; checks: SecurityCheck[];
    pssLevel: 'restricted' | 'baseline' | 'privileged';   // highest profile the template satisfies (approximation)
    counts: Record<CheckLevel, number>;
}

export const BASELINE_ALLOWED_CAPS: readonly string[] = ['AUDIT_WRITE', 'CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'FSETID',
    'KILL', 'MKNOD', 'NET_BIND_SERVICE', 'SETFCAP', 'SETGID', 'SETPCAP', 'SETUID', 'SYS_CHROOT'];
export const DANGEROUS_CAPS: readonly string[] = ['ALL', 'SYS_ADMIN', 'NET_ADMIN', 'SYS_PTRACE', 'SYS_MODULE',
    'SYS_RAWIO', 'BPF', 'PERFMON', 'DAC_READ_SEARCH'];
export const BASELINE_SELINUX_TYPES: readonly string[] = ['container_t', 'container_init_t', 'container_kvm_t', 'container_engine_t'];
export const BASELINE_SAFE_SYSCTLS: readonly string[] = ['kernel.shm_rmid_forced', 'net.ipv4.ip_local_port_range',
    'net.ipv4.ip_unprivileged_port_start', 'net.ipv4.tcp_syncookies', 'net.ipv4.ping_group_range',
    'net.ipv4.ip_local_reserved_ports', 'net.ipv4.tcp_keepalive_time', 'net.ipv4.tcp_fin_timeout',
    'net.ipv4.tcp_keepalive_intvl', 'net.ipv4.tcp_keepalive_probes'];
export const RESTRICTED_VOLUME_TYPES: readonly string[] = ['configMap', 'csi', 'downwardAPI', 'emptyDir',
    'ephemeral', 'persistentVolumeClaim', 'projected', 'secret'];

const APPARMOR_ANNOTATION_PREFIX = 'container.apparmor.security.beta.kubernetes.io/';

type Container = Jsonified<V1Container>;
type CheckInput = Omit<SecurityCheck, 'scope' | 'container'>;

function pick<T>(containerValue: T | undefined | null, podValue: T | undefined | null): { value: T | null; source: ValueSource } {
    if (containerValue !== undefined && containerValue !== null) return { value: containerValue, source: 'container' };
    if (podValue !== undefined && podValue !== null) return { value: podValue, source: 'pod' };
    return { value: null, source: 'unset' };
}

function normalizeCap(cap: string): string {
    const up = String(cap).trim().toUpperCase();
    return up.startsWith('CAP_') ? up.slice(4) : up;
}

function appArmorFromAnnotation(value: string | undefined): string | null {
    if (!value) return null;
    if (value === 'runtime/default') return 'RuntimeDefault';
    if (value.startsWith('localhost/')) return 'Localhost';
    if (value === 'unconfined') return 'Unconfined';
    return value;
}

/** Effective security settings for one container, applying Kubernetes pod/container precedence. */
export function resolveEffectiveSecurityContext(template: PodTemplate, container: Jsonified<V1Container>,
    kind: 'init' | 'sidecar' | 'main'): EffectiveContainerSecurity {
    const pod = template.spec?.securityContext ?? {};
    const sc = container.securityContext ?? {};
    const appArmor: EffectiveContainerSecurity['appArmorProfile'] = pick(sc.appArmorProfile?.type, pod.appArmorProfile?.type);
    if (appArmor.source === 'unset') {
        const fromAnnotation = appArmorFromAnnotation(template.metadata?.annotations?.[`${APPARMOR_ANNOTATION_PREFIX}${container.name}`]);
        if (fromAnnotation) { appArmor.value = fromAnnotation; appArmor.source = 'annotation'; }
    }
    return {
        container: container.name, kind,
        runAsUser: pick(sc.runAsUser, pod.runAsUser),
        runAsGroup: pick(sc.runAsGroup, pod.runAsGroup),
        runAsNonRoot: pick(sc.runAsNonRoot, pod.runAsNonRoot),
        seccompProfile: pick(sc.seccompProfile?.type, pod.seccompProfile?.type),
        appArmorProfile: appArmor,
        seLinuxOptions: pick(sc.seLinuxOptions, pod.seLinuxOptions),
        privileged: sc.privileged === true,
        allowPrivilegeEscalation: typeof sc.allowPrivilegeEscalation === 'boolean' ? sc.allowPrivilegeEscalation : null,
        readOnlyRootFilesystem: sc.readOnlyRootFilesystem === true,
        capabilitiesAdd: (sc.capabilities?.add ?? []).map(normalizeCap),
        capabilitiesDrop: (sc.capabilities?.drop ?? []).map(normalizeCap),
        procMount: sc.procMount ?? null,
        hostPorts: (container.ports ?? []).map(p => p.hostPort).filter((p): p is number => typeof p === 'number' && p > 0),
    };
}

function containerCheck(eff: EffectiveContainerSecurity, c: CheckInput): SecurityCheck {
    return { ...c, scope: 'container', container: eff.container };
}

function podCheck(c: CheckInput): SecurityCheck {
    return { ...c, scope: 'pod', container: null };
}

/** Runs-as-root truth table (first match wins). Explicit runAsNonRoot:false is treated as unset. */
export function evaluateRunAsRoot(eff: EffectiveContainerSecurity): SecurityCheck {
    const uid = eff.runAsUser.value;
    const nonRoot = eff.runAsNonRoot.value === true;
    const uidPart = uid === null ? 'runAsUser unset' : `runAsUser=${uid} (${eff.runAsUser.source})`;
    const nonRootPart = eff.runAsNonRoot.value === null
        ? 'runAsNonRoot unset'
        : `runAsNonRoot=${eff.runAsNonRoot.value} (${eff.runAsNonRoot.source}${eff.runAsNonRoot.value === false ? ', explicitly false' : ''})`;
    const detail = `${uidPart}; ${nonRootPart}`;
    const row = (level: CheckLevel, pssViolation: boolean, title: string) =>
        containerCheck(eff, { id: 'run-as-root', level, pss: 'restricted', pssViolation, title, detail });
    if (uid === 0) {
        return nonRoot
            ? row('fail', true, 'Pod will fail to start: runAsNonRoot=true with runAsUser=0')
            : row('fail', true, 'Runs as root (runAsUser=0)');
    }
    if (uid !== null) {
        return nonRoot
            ? row('pass', false, `Runs as non-root uid ${uid}`)
            : row('pass', true, `Runs as uid ${uid}; runAsNonRoot not set (Restricted requires it)`);
    }
    return nonRoot
        ? row('pass', false, 'Non-root enforced by kubelet (image USER must be numeric, non-zero)')
        : row('warn', true, 'May run as root (depends on image USER)');
}

/** One check per added capability. */
export function evaluateAddedCapability(container: string, cap: string): SecurityCheck {
    const name = normalizeCap(cap);
    const base = { id: 'capabilities-add', scope: 'container' as const, container, detail: `capabilities.add includes ${name}` };
    if (name === 'ALL' || DANGEROUS_CAPS.includes(name)) {
        return { ...base, level: 'fail', pss: 'baseline', pssViolation: true, title: `Dangerous capability ${name} added` };
    }
    if (!BASELINE_ALLOWED_CAPS.includes(name)) {
        return { ...base, level: 'warn', pss: 'baseline', pssViolation: true, title: `Capability ${name} not allowed by Baseline` };
    }
    if (name === 'NET_BIND_SERVICE') {
        return { ...base, level: 'pass', pss: 'restricted', pssViolation: false, title: 'NET_BIND_SERVICE added (allowed by Restricted)' };
    }
    return { ...base, level: 'warn', pss: 'restricted', pssViolation: true, title: `Capability ${name} not allowed by Restricted` };
}

function evaluateContainer(eff: EffectiveContainerSecurity): SecurityCheck[] {
    const checks: SecurityCheck[] = [evaluateRunAsRoot(eff)];
    const add = (c: CheckInput) => checks.push(containerCheck(eff, c));
    const src = (s: string) => ` (${s})`;

    const gid = eff.runAsGroup.value;
    if (gid !== null && gid > 0) add({ id: 'run-as-group', level: 'pass', pss: null, pssViolation: false, title: `Runs with gid ${gid}`, detail: `runAsGroup=${gid}${src(eff.runAsGroup.source)}` });
    else if (gid === null) add({ id: 'run-as-group', level: 'warn', pss: null, pssViolation: false, title: 'runAsGroup not set', detail: 'primary group may be root' });
    else add({ id: 'run-as-group', level: 'warn', pss: null, pssViolation: false, title: 'Runs with root group (runAsGroup=0)', detail: `runAsGroup=0${src(eff.runAsGroup.source)}` });

    add(eff.privileged
        ? { id: 'privileged', level: 'fail', pss: 'baseline', pssViolation: true, title: 'Privileged container', detail: 'securityContext.privileged=true grants full host access' }
        : { id: 'privileged', level: 'pass', pss: 'baseline', pssViolation: false, title: 'Not privileged', detail: 'securityContext.privileged is false or unset' });

    if (eff.privileged || eff.allowPrivilegeEscalation === true) {
        add({ id: 'allow-privilege-escalation', level: 'fail', pss: 'restricted', pssViolation: true, title: 'Privilege escalation allowed',
            detail: eff.privileged ? 'privileged containers always allow escalation' : 'allowPrivilegeEscalation=true' });
    } else if (eff.allowPrivilegeEscalation === false) {
        add({ id: 'allow-privilege-escalation', level: 'pass', pss: 'restricted', pssViolation: false, title: 'Privilege escalation disabled', detail: 'allowPrivilegeEscalation=false' });
    } else {
        add({ id: 'allow-privilege-escalation', level: 'warn', pss: 'restricted', pssViolation: true, title: 'allowPrivilegeEscalation not set', detail: 'defaults to true' });
    }

    add(eff.readOnlyRootFilesystem
        ? { id: 'read-only-root-fs', level: 'pass', pss: null, pssViolation: false, title: 'Read-only root filesystem', detail: 'readOnlyRootFilesystem=true' }
        : { id: 'read-only-root-fs', level: 'warn', pss: null, pssViolation: false, title: 'Writable root filesystem', detail: 'readOnlyRootFilesystem is false or unset' });

    add(eff.capabilitiesDrop.includes('ALL')
        ? { id: 'capabilities-drop', level: 'pass', pss: 'restricted', pssViolation: false, title: 'Drops ALL capabilities', detail: 'capabilities.drop includes ALL' }
        : { id: 'capabilities-drop', level: 'warn', pss: 'restricted', pssViolation: true, title: 'Does not drop ALL capabilities',
            detail: eff.capabilitiesDrop.length ? `drops ${eff.capabilitiesDrop.join(', ')}` : 'capabilities.drop not set' });

    if (eff.capabilitiesAdd.length === 0) {
        add({ id: 'capabilities-add', level: 'pass', pss: null, pssViolation: false, title: 'No capabilities added', detail: 'capabilities.add is empty' });
    } else {
        for (const cap of eff.capabilitiesAdd) checks.push(evaluateAddedCapability(eff.container, cap));
    }

    const seccomp = eff.seccompProfile.value;
    if (seccomp === 'RuntimeDefault' || seccomp === 'Localhost') {
        add({ id: 'seccomp', level: 'pass', pss: 'restricted', pssViolation: false, title: `seccomp ${seccomp}`, detail: `seccompProfile.type=${seccomp}${src(eff.seccompProfile.source)}` });
    } else if (seccomp === 'Unconfined') {
        add({ id: 'seccomp', level: 'fail', pss: 'baseline', pssViolation: true, title: 'seccomp Unconfined', detail: `seccompProfile.type=Unconfined${src(eff.seccompProfile.source)}` });
    } else {
        add({ id: 'seccomp', level: 'warn', pss: 'restricted', pssViolation: true, title: 'seccomp profile not set',
            detail: seccomp ? `unrecognized seccompProfile.type=${seccomp}` : 'Restricted requires RuntimeDefault or Localhost' });
    }

    const apparmor = eff.appArmorProfile.value;
    add(apparmor === 'Unconfined'
        ? { id: 'apparmor', level: 'fail', pss: 'baseline', pssViolation: true, title: 'AppArmor Unconfined', detail: `AppArmor profile Unconfined${src(eff.appArmorProfile.source)}` }
        : { id: 'apparmor', level: 'pass', pss: 'baseline', pssViolation: false, title: apparmor ? `AppArmor ${apparmor}` : 'AppArmor default',
            detail: apparmor ? `AppArmor profile ${apparmor}${src(eff.appArmorProfile.source)}` : 'AppArmor profile unset (runtime default)' });

    const se = eff.seLinuxOptions.value;
    const seBad = !!se && ((!!se.type && !BASELINE_SELINUX_TYPES.includes(se.type)) || !!se.user || !!se.role);
    add(seBad
        ? { id: 'selinux', level: 'fail', pss: 'baseline', pssViolation: true, title: 'Custom SELinux options',
            detail: `seLinuxOptions ${JSON.stringify(se)}${src(eff.seLinuxOptions.source)}` }
        : { id: 'selinux', level: 'pass', pss: 'baseline', pssViolation: false, title: 'SELinux options allowed',
            detail: se ? `seLinuxOptions ${JSON.stringify(se)}${src(eff.seLinuxOptions.source)}` : 'seLinuxOptions unset' });

    const pm = eff.procMount;
    add(pm === null || pm === 'Default'
        ? { id: 'proc-mount', level: 'pass', pss: 'baseline', pssViolation: false, title: 'Default /proc mount', detail: `procMount ${pm ?? 'unset'}` }
        : { id: 'proc-mount', level: 'fail', pss: 'baseline', pssViolation: true, title: `procMount ${pm}`, detail: 'Baseline allows only the Default procMount' });

    add(eff.hostPorts.length === 0
        ? { id: 'host-port', level: 'pass', pss: 'baseline', pssViolation: false, title: 'No host ports', detail: 'no ports[].hostPort' }
        : { id: 'host-port', level: 'warn', pss: 'baseline', pssViolation: true, title: 'Uses host ports', detail: `hostPort ${eff.hostPorts.join(', ')}` });

    return checks;
}

function hostNamespaceCheck(id: string, field: string, value: boolean | undefined): SecurityCheck {
    return podCheck(value === true
        ? { id, level: 'fail', pss: 'baseline', pssViolation: true, title: `${field} enabled`, detail: `${field}=true shares the host namespace` }
        : { id, level: 'pass', pss: 'baseline', pssViolation: false, title: `${field} disabled`, detail: `${field} is false or unset` });
}

function evaluatePod(template: PodTemplate, sa: ServiceAccountSummary | null | undefined): SecurityCheck[] {
    const spec = template.spec;
    const checks: SecurityCheck[] = [
        hostNamespaceCheck('host-network', 'hostNetwork', spec?.hostNetwork),
        hostNamespaceCheck('host-pid', 'hostPID', spec?.hostPID),
        hostNamespaceCheck('host-ipc', 'hostIPC', spec?.hostIPC),
    ];
    const volumes = spec?.volumes ?? [];
    const hostPaths = volumes.filter(v => v.hostPath).map(v => `${v.name}: ${v.hostPath?.path ?? ''}`);
    checks.push(podCheck(hostPaths.length === 0
        ? { id: 'host-path', level: 'pass', pss: 'baseline', pssViolation: false, title: 'No hostPath volumes', detail: 'no volume mounts a host path' }
        : { id: 'host-path', level: 'fail', pss: 'baseline', pssViolation: true, title: 'hostPath volumes', detail: hostPaths.join(', ') }));

    const otherTypes = volumes
        .map(v => ({ name: v.name, type: volumeTypeOf(v as Record<string, unknown>) }))
        .filter(v => v.type !== 'hostPath' && !RESTRICTED_VOLUME_TYPES.includes(v.type));
    checks.push(podCheck(otherTypes.length === 0
        ? { id: 'volume-types', level: 'pass', pss: 'restricted', pssViolation: false, title: 'Volume types allowed by Restricted', detail: 'all volumes use Restricted-allowed types' }
        : { id: 'volume-types', level: 'warn', pss: 'restricted', pssViolation: true, title: 'Volume types not allowed by Restricted',
            detail: otherTypes.map(v => `${v.name} (${v.type})`).join(', ') }));

    const sysctls = (spec?.securityContext?.sysctls ?? []).map(s => s.name);
    const unsafe = sysctls.filter(n => !BASELINE_SAFE_SYSCTLS.includes(n));
    checks.push(podCheck(unsafe.length === 0
        ? { id: 'sysctls', level: 'pass', pss: 'baseline', pssViolation: false, title: 'No unsafe sysctls', detail: sysctls.length ? `sysctls ${sysctls.join(', ')}` : 'no sysctls set' }
        : { id: 'sysctls', level: 'fail', pss: 'baseline', pssViolation: true, title: 'Unsafe sysctls', detail: unsafe.join(', ') }));

    const podAutomount = spec?.automountServiceAccountToken;
    const saAutomount = sa?.automountServiceAccountToken ?? null;
    const effAutomount = typeof podAutomount === 'boolean' ? podAutomount : saAutomount;
    const automountSource = typeof podAutomount === 'boolean' ? 'pod spec' : saAutomount !== null ? 'service account' : 'default';
    checks.push(podCheck(effAutomount === false
        ? { id: 'automount-sa-token', level: 'pass', pss: null, pssViolation: false, title: 'Service account token not mounted', detail: `automountServiceAccountToken=false (${automountSource})` }
        : { id: 'automount-sa-token', level: 'warn', pss: null, pssViolation: false, title: 'Service account token auto-mounted',
            detail: effAutomount === true ? `automountServiceAccountToken=true (${automountSource})` : 'automountServiceAccountToken unset (defaults to true)' }));

    const saName = spec?.serviceAccountName || spec?.serviceAccount || 'default';
    const missing = sa && !sa.exists ? ' (not found)' : '';
    checks.push(podCheck(saName === 'default'
        ? { id: 'service-account', level: 'info', pss: null, pssViolation: false, title: 'Default service account', detail: `uses the namespace default SA${missing}` }
        : { id: 'service-account', level: 'info', pss: null, pssViolation: false, title: `Service account ${saName}`, detail: `serviceAccountName=${saName}${missing}` }));

    const podSecrets = (spec?.imagePullSecrets ?? []).map(s => s.name).filter((n): n is string => !!n);
    const saSecrets = sa?.imagePullSecretNames ?? [];
    const pullParts = [
        podSecrets.length ? `pod: ${podSecrets.join(', ')}` : null,
        saSecrets.length ? `service account: ${saSecrets.join(', ')}` : null,
    ].filter(Boolean);
    checks.push(podCheck({ id: 'image-pull-secrets', level: 'info', pss: null, pssViolation: false,
        title: pullParts.length ? 'Image pull secrets' : 'No image pull secrets', detail: pullParts.length ? pullParts.join('; ') : 'none configured' }));

    if (sa?.irsaRoleArn) {
        checks.push(podCheck({ id: 'irsa', level: 'info', pss: null, pssViolation: false, title: 'IAM role for service account', detail: sa.irsaRoleArn }));
    }
    return checks;
}

/** Highest PSS profile satisfied, from pssViolation only (`level` is not consulted). */
export function computePssLevel(checks: SecurityCheck[]): SecurityPostureReport['pssLevel'] {
    if (checks.some(c => c.pssViolation && c.pss === 'baseline')) return 'privileged';
    if (checks.some(c => c.pssViolation && c.pss === 'restricted')) return 'baseline';
    return 'restricted';
}

/** Full security posture: pod-level checks first, then per-container checks (init, sidecar, main order). */
export function evaluateSecurityPosture(template: PodTemplate,
    opts?: { serviceAccount?: ServiceAccountSummary | null }): SecurityPostureReport {
    const all: { c: Container; kind: EffectiveContainerSecurity['kind'] }[] = [
        ...(template.spec?.initContainers ?? []).map(c => ({ c, kind: c.restartPolicy === 'Always' ? 'sidecar' as const : 'init' as const })),
        ...(template.spec?.containers ?? []).map(c => ({ c, kind: 'main' as const })),
    ];
    const containers = all.map(({ c, kind }) => resolveEffectiveSecurityContext(template, c, kind));
    const checks = [...evaluatePod(template, opts?.serviceAccount), ...containers.flatMap(evaluateContainer)];
    const counts: Record<CheckLevel, number> = { pass: 0, warn: 0, fail: 0, info: 0 };
    for (const c of checks) counts[c.level]++;
    return { containers, checks, pssLevel: computePssLevel(checks), counts };
}
