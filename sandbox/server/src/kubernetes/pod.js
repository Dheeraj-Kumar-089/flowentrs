import { k8sCoreV1Api } from "./config.js";

const registry = process.env.ECR_REGISTRY || '360821545863.dkr.ecr.ap-south-1.amazonaws.com';
const imageTag = process.env.SANDBOX_IMAGE_TAG || 'v1';
const imageFor = (name) => `${registry}/${name}:${imageTag}`;

export async function createPod(sandboxId, projectId) {

    const podManifest = {
        metadata: {
            name: `sandbox-pod-${sandboxId}`,
            labels: {
                sandboxId: sandboxId,
                projectId: projectId
            }
        },
        spec: {
            volumes: [
                {
                    name: 'workspace-volume',
                    emptyDir: {}
                }
            ],
            initContainers: [
                {
                    name: 'init-container',
                    image: imageFor('template'),
                    imagePullPolicy: "IfNotPresent",
                    command: [ 'sh', '-c', 'cp -r /workspace/. /seed/' ],
                    volumeMounts: [
                        {
                            name: 'workspace-volume',
                            mountPath: '/seed'
                        }
                    ]
                }
            ],
            containers: [
                {
                    image: imageFor('template'),
                    imagePullPolicy: "IfNotPresent",
                    name: 'sandbox-container',
                    ports: [ { containerPort: 5173, name: "http" } ],
                    resources: {
                        limits: { cpu: "500m", memory: "1Gi" },
                        requests: { cpu: "20m", memory: "128Mi" }
                    },
                    readinessProbe: {
                        httpGet: { path: "/", port: 5173 },
                        initialDelaySeconds: 2,
                        periodSeconds: 2,
                        timeoutSeconds: 2,
                        failureThreshold: 60
                    },
                    volumeMounts: [
                        {
                            name: 'workspace-volume',
                            mountPath: '/workspace'
                        }
                    ]
                },
                {
                    image: imageFor('agent'),
                    imagePullPolicy: "IfNotPresent",
                    name: 'agent-container',
                    ports: [ { containerPort: 3000, name: "http" } ],
                    resources: {
                        limits: { cpu: "500m", memory: "1Gi" },
                        requests: { cpu: "20m", memory: "64Mi" }
                    },
                    readinessProbe: {
                        httpGet: { path: "/", port: 3000 },
                        initialDelaySeconds: 1,
                        periodSeconds: 2,
                        timeoutSeconds: 2,
                        failureThreshold: 60
                    },
                    volumeMounts: [
                        {
                            name: 'workspace-volume',
                            mountPath: '/workspace'
                        }
                    ]
                },
                {
                    image: imageFor('sync-agent'),
                    imagePullPolicy: "IfNotPresent",
                    name: 'sync-agent-container',
                    ports: [ { containerPort: 4000, name: "http" } ],
                    resources: {
                        limits: { cpu: "500m", memory: "1Gi" },
                        requests: { cpu: "20m", memory: "64Mi" }
                    },
                    volumeMounts: [
                        {
                            name: 'workspace-volume',
                            mountPath: '/workspace'
                        }
                    ],
                    env: [
                        {
                            name: "PROJECT_ID",
                            value: projectId
                        },
                        {
                            name: "AWS_ACCESS_KEY_ID",
                            valueFrom: {
                                secretKeyRef: {
                                    name: "aws",
                                    key: "AWS_ACCESS_KEY_ID"
                                }
                            }
                        },
                        {
                            name: "AWS_SECRET_ACCESS_KEY",
                            valueFrom: {
                                secretKeyRef: {
                                    name: "aws",
                                    key: "AWS_SECRET_ACCESS_KEY"
                                }
                            }

                        },
                        {
                            name: "AWS_REGION",
                            valueFrom: {
                                secretKeyRef: {
                                    name: "aws",
                                    key: "AWS_REGION"
                                }
                            }
                        },
                        {
                            name: "S3_BUCKET_NAME",
                            valueFrom: {
                                secretKeyRef: {
                                    name: "aws",
                                    key: "S3_BUCKET_NAME"
                                }
                            }
                        }
                    ]
                }
            ]
        }
    }

    const response = await k8sCoreV1Api.createNamespacedPod({
        namespace: 'default',
        body: podManifest
    })

    return response;
}

export async function findProjectSandbox(projectId) {
    const podList = await k8sCoreV1Api.listNamespacedPod({
        namespace: 'default',
        labelSelector: `projectId=${projectId}`
    });

    const activePods = (podList.items ?? []).filter(pod =>
        !pod.metadata?.deletionTimestamp &&
        ![ 'Failed', 'Succeeded' ].includes(pod.status?.phase)
    );

    const readyPod = activePods.find(pod =>
        pod.status?.conditions?.some(condition =>
            condition.type === 'Ready' && condition.status === 'True'
        )
    );

    const pod = readyPod ?? activePods[ 0 ];
    return pod?.metadata?.labels?.sandboxId ?? null;
}

export async function getPodStatus(sandboxId) {
    const pod = await k8sCoreV1Api.readNamespacedPod({
        namespace: 'default',
        name: `sandbox-pod-${sandboxId}`
    });

    const conditions = pod.status?.conditions ?? [];
    const ready = conditions.find(condition => condition.type === 'Ready');
    const scheduled = conditions.find(condition => condition.type === 'PodScheduled');

    if (ready?.status === 'True') {
        return { status: 'ready', phase: pod.status?.phase ?? 'Running' };
    }

    if (pod.status?.phase === 'Failed') {
        return {
            status: 'failed',
            phase: pod.status.phase,
            reason: pod.status.reason ?? pod.status.message ?? 'Sandbox pod failed'
        };
    }

    return {
        status: 'pending',
        phase: pod.status?.phase ?? 'Pending',
        reason: scheduled?.status === 'False'
            ? scheduled.message
            : 'Waiting for sandbox containers to become ready'
    };
}

export async function getSandboxProjectId(sandboxId) {
    const pod = await k8sCoreV1Api.readNamespacedPod({
        namespace: 'default',
        name: `sandbox-pod-${sandboxId}`
    });

    return pod.metadata?.labels?.projectId ?? null;
}

export async function deletePod(sandboxId) {
    const response = await k8sCoreV1Api.deleteNamespacedPod({
        namespace: 'default',
        name: `sandbox-pod-${sandboxId}`,
        gracePeriodSeconds: 0,
        propagationPolicy: 'Background'
    })

    return response;
}

export async function waitForPodDeletion(sandboxId, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        try {
            await k8sCoreV1Api.readNamespacedPod({
                namespace: 'default',
                name: `sandbox-pod-${sandboxId}`
            });
        } catch (error) {
            if (error?.code === 404 || error?.response?.statusCode === 404) return;
            throw error;
        }

        await new Promise(resolve => setTimeout(resolve, 250));
    }

    throw new Error('Timed out waiting for sandbox pod deletion');
}
