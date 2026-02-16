import { describe, it, expect } from 'vitest';
import {
    transformCloudTrailEvent,
    classifyIdentityType,
    isDateRangeExceeding90Days,
} from '../cloudtrail-utils';

describe('transformCloudTrailEvent', () => {
    it('extracts all fields from a complete CloudTrail event', () => {
        const raw = JSON.stringify({
            eventID: 'evt-123',
            eventTime: '2024-01-15T10:30:00Z',
            eventName: 'CreateNodegroup',
            userIdentity: { userName: 'admin', arn: 'arn:aws:iam::123456:user/admin' },
            sourceIPAddress: '10.0.0.1',
            userAgent: 'aws-cli/2.0',
            readOnly: false,
            resources: [{ resourceType: 'AWS::EKS::Nodegroup', resourceName: 'my-ng' }],
        });

        const result = transformCloudTrailEvent(raw);

        expect(result.eventId).toBe('evt-123');
        expect(result.eventTime).toBe('2024-01-15T10:30:00Z');
        expect(result.eventName).toBe('CreateNodegroup');
        expect(result.username).toBe('admin');
        expect(result.sourceIpAddress).toBe('10.0.0.1');
        expect(result.userAgent).toBe('aws-cli/2.0');
        expect(result.readOnly).toBe(false);
        expect(result.resources).toEqual([{ resourceType: 'AWS::EKS::Nodegroup', resourceName: 'my-ng' }]);
        expect(result.rawEvent).toBe(raw);
    });

    it('defaults userAgent to empty string when missing', () => {
        const raw = JSON.stringify({
            eventID: 'evt-456',
            eventTime: '2024-01-15T11:00:00Z',
            eventName: 'DescribeCluster',
            userIdentity: { userName: 'reader' },
            sourceIPAddress: '10.0.0.2',
            readOnly: true,
        });

        const result = transformCloudTrailEvent(raw);

        expect(result.userAgent).toBe('');
    });

    it('defaults resources to empty array when missing', () => {
        const raw = JSON.stringify({
            eventID: 'evt-789',
            eventTime: '2024-01-15T12:00:00Z',
            eventName: 'ListClusters',
            userIdentity: { userName: 'ops' },
            sourceIPAddress: '10.0.0.3',
            userAgent: 'console.amazonaws.com',
        });

        const result = transformCloudTrailEvent(raw);

        expect(result.resources).toEqual([]);
    });

    it('falls back to arn when userName is missing', () => {
        const raw = JSON.stringify({
            eventID: 'evt-abc',
            eventTime: '2024-01-15T13:00:00Z',
            eventName: 'AccessKubernetesApi',
            userIdentity: { arn: 'arn:aws:sts::123456:assumed-role/MyRole/session1' },
            sourceIPAddress: '10.0.0.4',
            userAgent: 'kubectl/v1.28',
        });

        const result = transformCloudTrailEvent(raw);

        expect(result.username).toBe('arn:aws:sts::123456:assumed-role/MyRole/session1');
    });
});

describe('classifyIdentityType', () => {
    it('classifies plain username as iam-user', () => {
        expect(classifyIdentityType('admin')).toBe('iam-user');
    });

    it('classifies assumed-role pattern as iam-role', () => {
        expect(classifyIdentityType('assumed-role/MyRole/session123')).toBe('iam-role');
    });

    it('classifies ARN with :role/ as iam-role', () => {
        expect(classifyIdentityType('arn:aws:iam::123456:role/MyRole')).toBe('iam-role');
    });

    it('classifies system:serviceaccount pattern as service-account', () => {
        expect(classifyIdentityType('system:serviceaccount:kube-system:coredns')).toBe('service-account');
    });

    it('classifies empty string as unknown', () => {
        expect(classifyIdentityType('')).toBe('unknown');
    });
});

describe('isDateRangeExceeding90Days', () => {
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

    it('returns false for exactly 90 days', () => {
        const start = new Date('2024-01-01T00:00:00Z');
        const end = new Date(start.getTime() + NINETY_DAYS_MS);

        expect(isDateRangeExceeding90Days(start, end)).toBe(false);
    });

    it('returns true for 91 days', () => {
        const start = new Date('2024-01-01T00:00:00Z');
        const end = new Date(start.getTime() + 91 * 24 * 60 * 60 * 1000);

        expect(isDateRangeExceeding90Days(start, end)).toBe(true);
    });

    it('returns false for 89 days', () => {
        const start = new Date('2024-01-01T00:00:00Z');
        const end = new Date(start.getTime() + 89 * 24 * 60 * 60 * 1000);

        expect(isDateRangeExceeding90Days(start, end)).toBe(false);
    });

    it('returns true for 90 days + 1ms', () => {
        const start = new Date('2024-01-01T00:00:00Z');
        const end = new Date(start.getTime() + NINETY_DAYS_MS + 1);

        expect(isDateRangeExceeding90Days(start, end)).toBe(true);
    });
});
