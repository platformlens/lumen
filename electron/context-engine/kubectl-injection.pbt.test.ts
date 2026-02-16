/**
 * Property-based test for kubectl context injection.
 * Feature: ai-context-engine, Property 17: kubectl context injection includes active cluster and namespace
 * **Validates: Requirements 6.2**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildKubectlPrompt } from '../prompts';

/** Arbitrary generator for cluster names (realistic K8s context names). */
const arbClusterName = fc.stringMatching(/^[a-z][a-z0-9._-]{2,30}[a-z0-9]$/).filter(s => s.length >= 3);

/** Arbitrary generator for namespace names. */
const arbNamespace = fc.stringMatching(/^[a-z][a-z0-9-]{0,14}[a-z0-9]$/).filter(s => s.length >= 2);

// Feature: ai-context-engine, Property 17: kubectl context injection includes active cluster and namespace
// **Validates: Requirements 6.2**
describe('Property 17: kubectl context injection includes active cluster and namespace', () => {
    it('prompt context contains both the cluster name and namespace strings', () => {
        fc.assert(
            fc.property(
                arbClusterName,
                arbNamespace,
                (clusterName, namespace) => {
                    const prompt = buildKubectlPrompt(clusterName, namespace);

                    // Must contain the cluster name
                    expect(prompt).toContain(clusterName);

                    // Must contain the namespace
                    expect(prompt).toContain(namespace);

                    // Must contain kubectl mode markers
                    expect(prompt).toContain('KUBECTL MODE');

                    // Must contain destructive command warning instructions
                    expect(prompt).toContain('destructive');
                }
            ),
            { numRuns: 100 }
        );
    });
});
