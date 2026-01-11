import React from 'react';
import { DeploymentDetails } from '../resources/details/DeploymentDetails';
import { PodDetails } from '../resources/details/PodDetails';
import { ServiceDetails } from '../resources/details/ServiceDetails';
import { ClusterRoleBindingDetails } from '../resources/details/ClusterRoleBindingDetails';
import { HpaDetails } from '../resources/details/HpaDetails';
import { RoleBindingDetails } from '../resources/details/RoleBindingDetails';
import { ServiceAccountDetails } from '../resources/details/ServiceAccountDetails';
import { RoleDetails } from '../resources/details/RoleDetails';
import { CrdDetails } from '../resources/details/CrdDetails';
import { GenericResourceDetails } from '../resources/details/GenericResourceDetails';
import { NodeDetails } from '../resources/details/NodeDetails';
import { ReplicaSetDetails } from '../resources/details/ReplicaSetDetails';
import { DaemonSetDetails } from '../resources/details/DaemonSetDetails';
import { StatefulSetDetails } from '../resources/details/StatefulSetDetails';
import { JobDetails } from '../resources/details/JobDetails';
import { CronJobDetails } from '../resources/details/CronJobDetails';
import { PriorityClassDetails } from '../resources/details/PriorityClassDetails';
import { PodDisruptionBudgetDetails } from '../resources/details/PodDisruptionBudgetDetails';
import { NamespaceDetails } from '../resources/details/NamespaceDetails';
import { NodePoolDetails } from '../resources/details/NodePoolDetails';
import { SecretDetails } from '../resources/details/SecretDetails';

interface DrawerDetailsRendererProps {
    selectedResource: any;
    detailedResource: any;
    clusterName: string;
    onExplain: (resource: any) => void;
    onNavigate: (kind: string, name: string) => void;
    onOpenLogs: (pod: any, containerName: string) => void;
    onShowTopology?: () => void;
    onOpenYaml?: (resource: any) => void;
}

export const DrawerDetailsRenderer: React.FC<DrawerDetailsRendererProps> = ({
    selectedResource,
    detailedResource,
    clusterName,
    onExplain,
    onNavigate,
    onOpenLogs,
    onShowTopology,
    onOpenYaml
}) => {
    if (!selectedResource || !detailedResource) return null;

    const handleExplain = () => onExplain(selectedResource);
    const handleOpenYaml = onOpenYaml ? () => onOpenYaml(selectedResource) : undefined;

    switch (selectedResource.type) {
        case 'deployment':
            return (
                <DeploymentDetails
                    deployment={detailedResource}
                    onExplain={handleExplain}
                    onOpenYaml={handleOpenYaml}
                    onShowTopology={onShowTopology}
                    clusterName={clusterName}
                />
            );
        case 'replicaset':
            return (
                <ReplicaSetDetails
                    replicaSet={detailedResource}
                    onExplain={handleExplain}
                    onOpenYaml={handleOpenYaml}
                    onNavigate={onNavigate}
                    onShowTopology={onShowTopology}
                    clusterName={clusterName}
                />
            );
        case 'daemonset':
            return (
                <DaemonSetDetails
                    daemonSet={detailedResource}
                    onExplain={handleExplain}
                    onOpenYaml={handleOpenYaml}
                    onShowTopology={onShowTopology}
                    clusterName={clusterName}
                />
            );
        case 'statefulset':
            return (
                <StatefulSetDetails
                    statefulSet={detailedResource}
                    onExplain={handleExplain}
                    onOpenYaml={handleOpenYaml}
                    onShowTopology={onShowTopology}
                    clusterName={clusterName}
                />
            );
        case 'job':
            return (
                <JobDetails
                    job={detailedResource}
                    onExplain={handleExplain}
                    onOpenYaml={handleOpenYaml}
                    onShowTopology={onShowTopology}
                    clusterName={clusterName}
                />
            );
        case 'cronjob':
            return (
                <CronJobDetails
                    cronJob={detailedResource}
                    onExplain={handleExplain}
                    onOpenYaml={handleOpenYaml}
                    onShowTopology={onShowTopology}
                    clusterName={clusterName}
                />
            );
        case 'service':
            return (
                <ServiceDetails
                    resource={detailedResource}
                    clusterName={clusterName}
                    onExplain={handleExplain}
                    onOpenYaml={handleOpenYaml}
                    onShowTopology={onShowTopology}
                />
            );
        case 'pod':
            return (
                <PodDetails
                    pod={detailedResource}
                    onOpenLogs={(container) => onOpenLogs(detailedResource, container)}
                    onExplain={handleExplain}
                    onOpenYaml={handleOpenYaml}
                    onNavigate={onNavigate}
                    onShowTopology={onShowTopology}
                    clusterName={clusterName}
                />
            );
        case 'horizontalpodautoscaler':
            return <HpaDetails resource={detailedResource} />;
        case 'clusterrolebinding':
            return <ClusterRoleBindingDetails resource={detailedResource} onNavigate={onNavigate} />;
        case 'rolebinding':
            return <RoleBindingDetails resource={detailedResource} onNavigate={onNavigate} />;
        case 'serviceaccount':
            return <ServiceAccountDetails resource={detailedResource} />;
        case 'role':
        case 'clusterrole':
            return <RoleDetails resource={detailedResource} />;
        case 'node':
            return <NodeDetails node={detailedResource} />;
        case 'namespace':
            return (
                <NamespaceDetails
                    namespace={detailedResource}
                    onExplain={handleExplain}
                    onOpenYaml={handleOpenYaml}
                />
            );
        case 'crd-definition':
            return (
                <CrdDetails
                    crd={detailedResource}
                    onOpenYaml={handleOpenYaml}
                />
            );
        case 'custom-resource':
            if (detailedResource.kind === 'NodePool' && detailedResource.apiVersion?.includes('karpenter.sh')) {
                return (
                    <NodePoolDetails
                        nodePool={detailedResource}
                        onExplain={handleExplain}
                        onOpenYaml={handleOpenYaml}
                    />
                );

            }
            // Fallthrough to generic if not handled specifically above
            return (
                <GenericResourceDetails
                    resource={detailedResource}
                    onExplain={handleExplain}
                    onOpenYaml={handleOpenYaml}
                />
            );
        case 'endpointslice':
        case 'endpoint':
        case 'ingress':
        case 'ingressclass':
        case 'networkpolicy':
        case 'persistentvolumeclaim':
        case 'persistentvolume':
        case 'storageclass':
        case 'configmap':
            return (
                <GenericResourceDetails
                    resource={detailedResource}
                    onExplain={handleExplain}
                    onOpenYaml={handleOpenYaml}
                />
            );
        case 'secret':
            return (
                <SecretDetails
                    secret={detailedResource}
                    onExplain={handleExplain}
                    onOpenYaml={handleOpenYaml}
                />
            );
        case 'horizontalpodautoscaler':
        case 'mutatingwebhookconfiguration':
        case 'validatingwebhookconfiguration':
        case 'runtimeclass':
            return (
                <GenericResourceDetails
                    resource={detailedResource}
                    onExplain={handleExplain}
                    onOpenYaml={handleOpenYaml}
                />
            );
        case 'poddisruptionbudget':
            return (
                <PodDisruptionBudgetDetails
                    podDisruptionBudget={detailedResource}
                    onExplain={handleExplain}
                    onOpenYaml={handleOpenYaml}
                />
            );
        case 'priorityclass':
            return (
                <PriorityClassDetails
                    priorityClass={detailedResource}
                    onExplain={handleExplain}
                    onOpenYaml={handleOpenYaml}
                />
            );
        default:
            return null;
    }
};
