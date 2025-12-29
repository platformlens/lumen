import React from 'react';
import { DeploymentDetails } from '../resources/details/DeploymentDetails';
import { PodDetails } from '../resources/details/PodDetails';
import { ServiceDetails } from '../resources/details/ServiceDetails';
import { ClusterRoleBindingDetails } from '../resources/details/ClusterRoleBindingDetails';
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

interface DrawerDetailsRendererProps {
    selectedResource: any;
    detailedResource: any;
    explanation: string | null;
    isExplaining: boolean;
    clusterName: string;
    onExplain: (resource: any) => void;
    onNavigate: (kind: string, name: string) => void;
    onOpenLogs: (pod: any, containerName: string) => void;
    onShowTopology?: () => void;
}

export const DrawerDetailsRenderer: React.FC<DrawerDetailsRendererProps> = ({
    selectedResource,
    detailedResource,
    explanation,
    isExplaining,
    clusterName,
    onExplain,
    onNavigate,
    onOpenLogs,
    onShowTopology
}) => {
    if (!selectedResource || !detailedResource) return null;

    const handleExplain = () => onExplain(selectedResource);

    switch (selectedResource.type) {
        case 'deployment':
            return (
                <DeploymentDetails 
                    deployment={detailedResource} 
                    explanation={explanation} 
                    onExplain={handleExplain}
                    isExplaining={isExplaining}
                    onShowTopology={onShowTopology}
                    clusterName={clusterName}
                />
            );
        case 'replicaset':
            return (
                <ReplicaSetDetails 
                    replicaSet={detailedResource} 
                    explanation={explanation} 
                    onExplain={handleExplain}
                    isExplaining={isExplaining}
                    onNavigate={onNavigate}
                    onShowTopology={onShowTopology}
                    clusterName={clusterName}
                />
            );
        case 'daemonset':
            return (
                <DaemonSetDetails 
                    daemonSet={detailedResource} 
                    explanation={explanation} 
                    onExplain={handleExplain}
                    isExplaining={isExplaining}
                    onShowTopology={onShowTopology}
                    clusterName={clusterName}
                />
            );
        case 'statefulset':
            return (
                <StatefulSetDetails 
                    statefulSet={detailedResource} 
                    explanation={explanation} 
                    onExplain={handleExplain}
                    isExplaining={isExplaining}
                    onShowTopology={onShowTopology}
                    clusterName={clusterName}
                />
            );
        case 'job':
            return (
                <JobDetails 
                    job={detailedResource} 
                    explanation={explanation} 
                    onExplain={handleExplain}
                    isExplaining={isExplaining}
                    onShowTopology={onShowTopology}
                    clusterName={clusterName}
                />
            );
        case 'cronjob':
            return (
                <CronJobDetails 
                    cronJob={detailedResource} 
                    explanation={explanation} 
                    onExplain={handleExplain}
                    isExplaining={isExplaining}
                    onShowTopology={onShowTopology}
                    clusterName={clusterName}
                />
            );
        case 'service':
            return (
                <ServiceDetails 
                    resource={detailedResource} 
                    clusterName={clusterName}
                    explanation={explanation}
                    onExplain={handleExplain}
                    isExplaining={isExplaining}
                    onShowTopology={onShowTopology}
                />
            );
        case 'pod':
            return (
                <PodDetails 
                    pod={detailedResource} 
                    explanation={explanation} 
                    onOpenLogs={(container) => onOpenLogs(detailedResource, container)} 
                    onExplain={handleExplain}
                    isExplaining={isExplaining}
                    onNavigate={onNavigate}
                    onShowTopology={onShowTopology}
                    clusterName={clusterName}
                />
            );
        case 'clusterrolebinding':
            return <ClusterRoleBindingDetails resource={detailedResource} />;
        case 'rolebinding':
            return <RoleBindingDetails resource={detailedResource} />;
        case 'serviceaccount':
            return <ServiceAccountDetails resource={detailedResource} />;
        case 'role':
            return <RoleDetails resource={detailedResource} />;
        case 'node':
            return <NodeDetails node={detailedResource} />;
        case 'crd-definition':
            return (
                <CrdDetails 
                    crd={detailedResource} 
                    explanation={explanation}
                />
            );
        case 'custom-resource':
        case 'endpointslice':
        case 'endpoint':
        case 'ingress':
        case 'ingressclass':
        case 'networkpolicy':
        case 'persistentvolumeclaim':
        case 'persistentvolume':
        case 'storageclass':
        case 'configmap':
        case 'secret':
        case 'horizontalpodautoscaler':
        case 'mutatingwebhookconfiguration':
        case 'validatingwebhookconfiguration':
        case 'runtimeclass':
            return (
                <GenericResourceDetails 
                    resource={detailedResource} 
                    explanation={explanation}
                    onExplain={handleExplain}
                    isExplaining={isExplaining}
                />
            );
        case 'poddisruptionbudget':
            return (
                <PodDisruptionBudgetDetails 
                    podDisruptionBudget={detailedResource} 
                    explanation={explanation}
                    onExplain={handleExplain}
                    isExplaining={isExplaining}
                />
            );
        case 'priorityclass':
            return (
                <PriorityClassDetails 
                    priorityClass={detailedResource} 
                    explanation={explanation}
                    onExplain={handleExplain}
                    isExplaining={isExplaining}
                />
            );
        default:
            return null;
    }
};
