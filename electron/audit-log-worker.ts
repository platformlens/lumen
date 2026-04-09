/**
 * Audit Log Worker - Uses CloudWatch Logs Insights to query
 * Kubernetes audit log events off the main thread.
 */

import { parentPort } from 'worker_threads';
import {
    CloudWatchLogsClient,
    StartQueryCommand,
    GetQueryResultsCommand,
    type GetQueryResultsCommandOutput,
} from '@aws-sdk/client-cloudwatch-logs';

// --- Interfaces ---

export interface AuditLogWorkerRequest {
    id: string;
    credentials: {
        accessKeyId: string;
        secretAccessKey: string;
        sessionToken?: string;
    };
    region: string;
    logGroupName: string;
    startTime: number;   // epoch seconds
    endTime: number;     // epoch seconds
    query: string;       // CloudWatch Logs Insights query string
}

export interface AuditLogWorkerResponse {
    id: string;
    events: Array<{
        timestamp: string;
        verb: string;
        username: string;
        groups: string[];
        namespace: string;
        resource: string;
        resourceName: string;
        statusCode: number;
        sourceIP: string;
        userAgent: string;
        rawEvent: string;
    }>;
    error?: string;
}

// --- Poll for query results ---

async function pollQueryResults(
    client: CloudWatchLogsClient,
    queryId: string,
    maxWaitMs = 30000,
): Promise<GetQueryResultsCommandOutput> {
    const startedAt = Date.now();
    let delay = 500;

    while (true) {
        const result = await client.send(new GetQueryResultsCommand({ queryId }));
        const status = result.status;

        if (status === 'Complete' || status === 'Failed' || status === 'Cancelled' || status === 'Timeout') {
            return result;
        }

        if (Date.now() - startedAt > maxWaitMs) {
            return result; // Return partial results if available
        }

        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 1.5, 3000);
    }
}

// --- Parse Insights result row into event ---

function parseInsightsRow(fields: Array<{ field?: string; value?: string }>): AuditLogWorkerResponse['events'][number] | null {
    const fieldMap = new Map<string, string>();
    for (const f of fields) {
        if (f.field && f.value !== undefined) fieldMap.set(f.field, f.value);
    }

    const rawMessage = fieldMap.get('@message') ?? '';
    const timestamp = fieldMap.get('@timestamp') ?? '';

    // Parse the full JSON message for complete data
    try {
        const parsed = JSON.parse(rawMessage);
        return {
            timestamp: parsed.requestReceivedTimestamp ?? parsed.stageTimestamp ?? timestamp,
            verb: parsed.verb ?? '',
            username: parsed.user?.username ?? '',
            groups: parsed.user?.groups ?? [],
            namespace: parsed.objectRef?.namespace ?? 'cluster-scoped',
            resource: parsed.objectRef?.resource ?? '',
            resourceName: parsed.objectRef?.name ?? '',
            statusCode: parsed.responseStatus?.code ?? 0,
            sourceIP: parsed.sourceIPs?.[0] ?? '',
            userAgent: parsed.userAgent ?? '',
            rawEvent: rawMessage,
        };
    } catch {
        // Fallback: use extracted fields from Insights
        return {
            timestamp,
            verb: fieldMap.get('verb') ?? '',
            username: fieldMap.get('user.username') ?? '',
            groups: [],
            namespace: fieldMap.get('objectRef.namespace') ?? 'cluster-scoped',
            resource: fieldMap.get('objectRef.resource') ?? '',
            resourceName: fieldMap.get('objectRef.name') ?? '',
            statusCode: 0,
            sourceIP: fieldMap.get('sourceIPs.0') ?? '',
            userAgent: '',
            rawEvent: rawMessage,
        };
    }
}

// --- Worker Message Listener ---

if (parentPort) {
    parentPort.on('message', async (message: AuditLogWorkerRequest) => {
        const { id, credentials, region, logGroupName, startTime, endTime, query } = message;

        try {
            const client = new CloudWatchLogsClient({
                region,
                credentials: {
                    accessKeyId: credentials.accessKeyId,
                    secretAccessKey: credentials.secretAccessKey,
                    sessionToken: credentials.sessionToken,
                },
            });

            const startResult = await client.send(new StartQueryCommand({
                logGroupName,
                startTime,
                endTime,
                queryString: query,
            }));

            if (!startResult.queryId) {
                throw new Error('Failed to start CloudWatch Logs Insights query');
            }

            const result = await pollQueryResults(client, startResult.queryId);

            if (result.status === 'Failed') {
                throw new Error('CloudWatch Logs Insights query failed');
            }

            const events: AuditLogWorkerResponse['events'] = [];
            for (const row of result.results ?? []) {
                const parsed = parseInsightsRow(row);
                if (parsed) events.push(parsed);
            }

            parentPort!.postMessage({ id, events } as AuditLogWorkerResponse);
        } catch (err: unknown) {
            const errMessage = err instanceof Error ? err.message : 'unknown error';
            const errName = err instanceof Error ? err.name : '';
            parentPort!.postMessage({
                id,
                events: [],
                error: errName ? `${errName}: ${errMessage}` : errMessage,
            } as AuditLogWorkerResponse);
        }
    });
}
