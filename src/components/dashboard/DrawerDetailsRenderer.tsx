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
import { Ec2InstanceDetails } from '../dashboard/views/Ec2InstanceDetails';
import { GatewayDetails } from '../resources/details/GatewayDetails';
import { VirtualServiceDetails } from '../resources/details/VirtualServiceDetails';
import { WebhookConfigurationDetails } from '../resources/details/WebhookConfigurationDetails';
import { ConfigMapDetails } from '../resources/details/ConfigMapDetails';
import { PersistentVolumeClaimDetails } from '../resources/details/PersistentVolumeClaimDetails';
import { ScaledObjectDetails } from '../resources/details/ScaledObjectDetails';
import { CertificateDetails } from '../resources/details/CertificateDetails';
import { ExternalSecretDetails } from '../resources/details/ExternalSecretDetails';
import { ClusterSecretStoreDetails } from '../resources/details/ClusterSecretStoreDetails';

interface DrawerDetailsRendererProps {
    selectedResource: any;
    detailedResource: any;
    clusterName: string;
    onExplain: (resource: any) => void;
    onNavigate: (kind: string, name: string, namespace?: string) => void;
    onOpenLogs: (pod: any, containerName: string) => void;
    onShowTopology?: () => void;
    onOpenYaml?: (resource: any) => void;
    onTriggerCronJob?: () => void;
    onCordonDrain?: (nodeName: string) => void;
    onDeleteNode?: (nodeName: string) => void;
}

export const DrawerDetailsRenderer: React.FC<DrawerDetailsRendererProps> = ({
    selectedResource,
    detailedResource,
    clusterName,
    onExplain,
    onNavigate,
    onOpenLogs,
    onShowTopology,
    onOpenYaml,
    onTriggerCronJob,
    onCordonDrain,
    onDeleteNode
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
                    onTrigger={onTriggerCronJob}
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
                    onNavigate={onNavigate}
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
            return (
                <NodeDetails
                    node={detailedResource}
                    clusterName={clusterName}
                    onNavigate={onNavigate}
                    onCordonDrain={onCordonDrain}
                    onDeleteNode={onDeleteNode}
                />
            );
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
            if (detailedResource.kind === 'Gateway' && detailedResource.apiVersion?.includes('networking.istio.io')) {
                return (
                    <GatewayDetails
                        gateway={detailedResource}
                        onExplain={handleExplain}
                        onOpenYaml={handleOpenYaml}
                    />
                );
            }
            if (detailedResource.kind === 'VirtualService' && detailedResource.apiVersion?.includes('networking.istio.io')) {
                return (
                    <VirtualServiceDetails
                        virtualService={detailedResource}
                        onExplain={handleExplain}
                        onOpenYaml={handleOpenYaml}
                        onNavigate={onNavigate}
                    />
                );
            }
            if (detailedResource.kind === 'ScaledObject' && detailedResource.apiVersion?.includes('keda.sh')) {
                return (
                    <ScaledObjectDetails
                        scaledObject={detailedResource}
                        onExplain={handleExplain}
                        onOpenYaml={handleOpenYaml}
                        onNavigate={onNavigate}
                    />
                );
            }
            if (detailedResource.kind === 'Certificate' && detailedResource.apiVersion?.includes('cert-manager.io')) {
                return (
                    <CertificateDetails
                        certificate={detailedResource}
                        onExplain={handleExplain}
                        onOpenYaml={handleOpenYaml}
                        onNavigate={onNavigate}
                    />
                );
            }
            if (detailedResource.kind === 'ExternalSecret' && detailedResource.apiVersion?.includes('external-secrets.io')) {
                return (
                    <ExternalSecretDetails
                        externalSecret={detailedResource}
                        onExplain={handleExplain}
                        onOpenYaml={handleOpenYaml}
                        onNavigate={onNavigate}
                    />
                );
            }
            if ((detailedResource.kind === 'ClusterSecretStore' || detailedResource.kind === 'SecretStore') && detailedResource.apiVersion?.includes('external-secrets.io')) {
                return (
                    <ClusterSecretStoreDetails
                        store={detailedResource}
                        onExplain={handleExplain}
                        onOpenYaml={handleOpenYaml}
                        onNavigate={onNavigate}
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
        case 'storageclass':
            return (
                <GenericResourceDetails
                    resource={detailedResource}
                    onExplain={handleExplain}
                    onOpenYaml={handleOpenYaml}
                />
            );
        case 'persistentvolumeclaim':
        case 'persistentvolume':
            return (
                <PersistentVolumeClaimDetails
                    pvc={detailedResource}
                    onExplain={handleExplain}
                    onOpenYaml={handleOpenYaml}
                />
            );
        case 'configmap':
            return (
                <ConfigMapDetails
                    configMap={detailedResource}
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
            return (
                <WebhookConfigurationDetails
                    resource={detailedResource}
                    onExplain={handleExplain}
                    onOpenYaml={handleOpenYaml}
                />
            );
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
        case 'ec2instance':
            return (
                <Ec2InstanceDetails
                    instance={detailedResource}
                    node={detailedResource._matchedNode}
                    clusterName={clusterName}
                />
            );
        default:
            return null;
    }
};
