/**
 * ConfigMap / Secret references and the volumes summary of a pod template (Config & Storage section).
 * Names only: Secret values are never read or displayed.
 */
import type { PodTemplate, ServiceAccountSummary } from '../../../../types/deployment-details';
import { volumeTypeOf } from '../../../../utils/container-insights-utils';

export interface ConfigRef { name: string; via: string[] }
export interface VolumeSummary { name: string; type: string; detail: string | null }
export interface ConfigRefs { configMaps: ConfigRef[]; secrets: ConfigRef[]; volumes: VolumeSummary[] }

class RefCollector {
    private readonly refs = new Map<string, Set<string>>();
    add(name: string | undefined | null, via: string) {
        if (!name) return;
        let set = this.refs.get(name);
        if (!set) { set = new Set(); this.refs.set(name, set); }
        set.add(via);
    }
    list(): ConfigRef[] {
        return [...this.refs.entries()]
            .map(([name, via]) => ({ name, via: [...via] }))
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    }
}

function volumeDetail(v: Record<string, unknown>, type: string): string | null {
    const src = v[type] as Record<string, unknown> | undefined;
    if (!src || typeof src !== 'object') return null;
    switch (type) {
        case 'hostPath': return String(src.path ?? '');
        case 'configMap': return `configmap ${String(src.name ?? '')}`;
        case 'secret': return `secret ${String(src.secretName ?? '')}`;
        case 'persistentVolumeClaim': return `claim ${String(src.claimName ?? '')}${src.readOnly ? ' (read-only)' : ''}`;
        case 'emptyDir': return src.medium ? `medium ${String(src.medium)}${src.sizeLimit ? `, ${String(src.sizeLimit)}` : ''}` : (src.sizeLimit ? `limit ${String(src.sizeLimit)}` : null);
        case 'projected': return `${Array.isArray(src.sources) ? src.sources.length : 0} sources`;
        case 'csi': return String(src.driver ?? '');
        case 'nfs': return `${String(src.server ?? '')}:${String(src.path ?? '')}`;
        default: return null;
    }
}

export function collectConfigRefs(template: PodTemplate, serviceAccount: ServiceAccountSummary | null): ConfigRefs {
    const spec = template.spec;
    const cms = new RefCollector();
    const secrets = new RefCollector();
    const containers = [...(spec?.initContainers ?? []), ...(spec?.containers ?? [])];
    for (const c of containers) {
        for (const e of c.env ?? []) {
            cms.add(e.valueFrom?.configMapKeyRef?.name, `env ${c.name}`);
            secrets.add(e.valueFrom?.secretKeyRef?.name, `env ${c.name}`);
        }
        for (const ef of c.envFrom ?? []) {
            cms.add(ef.configMapRef?.name, `envFrom ${c.name}`);
            secrets.add(ef.secretRef?.name, `envFrom ${c.name}`);
        }
    }
    const volumes: VolumeSummary[] = [];
    for (const v of spec?.volumes ?? []) {
        const raw = v as unknown as Record<string, unknown>;
        const type = volumeTypeOf(raw);
        volumes.push({ name: v.name, type, detail: volumeDetail(raw, type) });
        cms.add(v.configMap?.name, `volume ${v.name}`);
        secrets.add(v.secret?.secretName, `volume ${v.name}`);
        for (const s of v.projected?.sources ?? []) {
            cms.add(s.configMap?.name, `volume ${v.name}`);
            secrets.add(s.secret?.name, `volume ${v.name}`);
        }
    }
    for (const s of spec?.imagePullSecrets ?? []) secrets.add(s.name, 'imagePullSecrets');
    for (const n of serviceAccount?.imagePullSecretNames ?? []) secrets.add(n, 'service account imagePullSecrets');
    return { configMaps: cms.list(), secrets: secrets.list(), volumes };
}
