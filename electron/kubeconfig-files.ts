// Pure kubeconfig file helpers. Deliberately has NO electron imports so it can be unit-tested.
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { isValidTerminalContext } from './terminal-kubeconfig';

export interface ResolveKubeconfigOptions {
    /** User-configured kubeconfig path (settings_kubeconfigPath). Ignored when empty or missing on disk. */
    customPath?: string;
    env: Record<string, string | undefined>;
    homedir: string;
    /** Path list delimiter used by KUBECONFIG (':' on POSIX, ';' on Windows). */
    delimiter?: string;
    exists?: (p: string) => boolean;
}

export interface ContextSignatureEntry {
    name: string;
    cluster?: string;
    user?: string;
    namespace?: string;
}

function expandHome(p: string, homedir: string): string {
    if (p === '~') return homedir;
    if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(homedir, p.slice(2));
    return p;
}

/**
 * Resolve which kubeconfig file(s) are in use, in priority order:
 * custom path (if it exists) -> KUBECONFIG (split by delimiter) -> ~/.kube/config.
 */
export function resolveCustomKubeconfigPath(
    customPath: string | undefined,
    homedir: string,
    exists: (p: string) => boolean = (p: string) => fs.existsSync(p),
): string | undefined {
    const custom = (customPath ?? '').trim();
    if (!custom) return undefined;
    const expanded = expandHome(custom, homedir);
    return exists(expanded) ? expanded : undefined;
}

export function resolveKubeconfigFiles(opts: ResolveKubeconfigOptions): string[] {
    const exists = opts.exists ?? ((p: string) => fs.existsSync(p));
    const delimiter = opts.delimiter ?? path.delimiter;

    const custom = resolveCustomKubeconfigPath(opts.customPath, opts.homedir, exists);
    if (custom) return [custom];

    const envValue = (opts.env.KUBECONFIG ?? '').trim();
    if (envValue) {
        const parts = envValue
            .split(delimiter)
            .map(p => p.trim())
            .filter(Boolean)
            .map(p => expandHome(p, opts.homedir));
        if (parts.length > 0) return parts;
    }

    return [path.join(opts.homedir, '.kube', 'config')];
}

/** SHA-1 over each file's path and content (or 'missing'), so touches and identical rewrites hash the same. */
export function hashKubeconfigFiles(files: string[]): string {
    const hash = crypto.createHash('sha1');
    for (const file of files) {
        hash.update(file);
        hash.update('\0');
        try {
            hash.update(fs.readFileSync(file));
        } catch {
            hash.update('missing');
        }
        hash.update('\0');
    }
    return hash.digest('hex');
}

/** Stable signature of a context list (order-insensitive) used to decide whether the UI needs an update. */
export function contextsSignature(contexts: ContextSignatureEntry[]): string {
    return contexts
        .map(c => [c.name, c.cluster ?? '', c.user ?? '', c.namespace ?? ''].join('\u0001'))
        .sort()
        .join('\u0002');
}

/** Error with a user-facing message raised when a context rename is rejected or cannot be written safely. */
export class KubeconfigRenameError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'KubeconfigRenameError';
    }
}

export interface RenameContextResult {
    /** Real (symlink-resolved) paths of the files that were rewritten. */
    changedFiles: string[];
    newName: string;
    /** True when `current-context` pointed at the old name in at least one file and was updated. */
    renamedCurrentContext: boolean;
}

interface ParsedKubeconfig {
    file: string;
    realPath: string;
    original: string;
    mode: number;
    doc: Record<string, unknown>;
}

interface StagedWrite {
    realPath: string;
    original: string;
    mode: number;
    tempPath: string;
    backupPath: string;
}

// eslint-disable-next-line no-control-regex
const HAS_CONTROL_CHARS = /[\x00-\x1f\x7f]/;

function contextEntries(doc: Record<string, unknown>): { name?: unknown }[] {
    const contexts = doc.contexts;
    return Array.isArray(contexts)
        ? contexts.filter((c): c is { name?: unknown } => typeof c === 'object' && c !== null)
        : [];
}

function readKubeconfig(file: string): ParsedKubeconfig | null {
    let realPath: string;
    try {
        realPath = fs.realpathSync(file);
    } catch {
        return null; // missing file in a KUBECONFIG chain: nothing to rename there
    }

    const original = fs.readFileSync(realPath, 'utf8');
    let loaded: unknown;
    try {
        loaded = yaml.load(original);
    } catch {
        throw new KubeconfigRenameError(`Could not parse kubeconfig ${file}. Fix the file or remove extra YAML documents, then try again.`);
    }
    if (loaded === null || loaded === undefined) return null; // empty file
    if (typeof loaded !== 'object' || Array.isArray(loaded)) {
        throw new KubeconfigRenameError(`Kubeconfig ${file} is not a valid kubeconfig mapping.`);
    }

    return {
        file,
        realPath,
        original,
        mode: fs.statSync(realPath).mode & 0o7777,
        doc: loaded as Record<string, unknown>,
    };
}

function removeQuietly(p: string): void {
    try {
        fs.rmSync(p, { force: true });
    } catch {
        // best-effort cleanup
    }
}

/**
 * Equivalent of `kubectl config rename-context`: renames the context in every kubeconfig file that defines it
 * and updates `current-context` wherever it pointed at the old name. Validates first, stages every file as a
 * temp file next to its target, re-checks that nothing changed on disk, then swaps them in with a `.lumen.bak`
 * copy of each original. Comments and key ordering of the YAML are not preserved; no data is dropped.
 */
export function renameContextInFiles(files: string[], oldName: string, newName: string): RenameContextResult {
    const target = (newName ?? '').trim();
    if (!target) throw new KubeconfigRenameError('Context name cannot be empty.');
    if (target.length > 512) throw new KubeconfigRenameError('Context name is too long (maximum 512 characters).');
    if (HAS_CONTROL_CHARS.test(target) || !isValidTerminalContext(target)) {
        throw new KubeconfigRenameError('Context name contains invalid characters.');
    }
    if (target === oldName) throw new KubeconfigRenameError('The new name is the same as the current name.');

    const parsed: ParsedKubeconfig[] = [];
    const seenRealPaths = new Set<string>();
    for (const file of files) {
        const entry = readKubeconfig(file);
        if (!entry || seenRealPaths.has(entry.realPath)) continue;
        seenRealPaths.add(entry.realPath);
        parsed.push(entry);
    }

    if (parsed.some(p => contextEntries(p.doc).some(c => c.name === target))) {
        throw new KubeconfigRenameError(`A context named "${target}" already exists.`);
    }
    if (!parsed.some(p => contextEntries(p.doc).some(c => c.name === oldName))) {
        throw new KubeconfigRenameError(`Context "${oldName}" was not found in the kubeconfig. It may have been changed or removed.`);
    }

    let renamedCurrentContext = false;
    const changed: { entry: ParsedKubeconfig; text: string }[] = [];
    for (const entry of parsed) {
        let touched = false;
        for (const c of contextEntries(entry.doc)) {
            if (c.name === oldName) {
                c.name = target;
                touched = true;
            }
        }
        if (entry.doc['current-context'] === oldName) {
            entry.doc['current-context'] = target;
            renamedCurrentContext = true;
            touched = true;
        }
        if (touched) {
            changed.push({ entry, text: yaml.dump(entry.doc, { lineWidth: -1, noRefs: true }) });
        }
    }

    // Stage every temp file before touching any target
    const staged: StagedWrite[] = [];
    const renamed: StagedWrite[] = [];
    const createdBackups: string[] = [];
    try {
        for (const { entry, text } of changed) {
            const dir = path.dirname(entry.realPath);
            const tempPath = path.join(dir, `.${path.basename(entry.realPath)}.lumen-${crypto.randomUUID()}.tmp`);
            const fd = fs.openSync(tempPath, 'wx', entry.mode);
            staged.push({
                realPath: entry.realPath,
                original: entry.original,
                mode: entry.mode,
                tempPath,
                backupPath: `${entry.realPath}.lumen.bak`,
            });
            try {
                fs.writeFileSync(fd, text);
                fs.fsyncSync(fd);
            } finally {
                fs.closeSync(fd);
            }
            fs.chmodSync(tempPath, entry.mode);
        }

        // Abort if anything changed on disk since we read it
        for (const s of staged) {
            let current: string;
            try {
                current = fs.readFileSync(s.realPath, 'utf8');
            } catch {
                throw new KubeconfigRenameError('The kubeconfig changed while renaming. Nothing was changed; please try again.');
            }
            if (current !== s.original) {
                throw new KubeconfigRenameError('The kubeconfig changed while renaming. Nothing was changed; please try again.');
            }
        }

        for (const s of staged) {
            fs.writeFileSync(s.backupPath, s.original, { mode: s.mode });
            fs.chmodSync(s.backupPath, s.mode);
            createdBackups.push(s.backupPath);
        }

        for (const s of staged) {
            fs.renameSync(s.tempPath, s.realPath);
            renamed.push(s);
        }
    } catch (err) {
        // Roll back files that were already swapped, then drop every temp file
        for (const s of renamed) {
            try {
                fs.writeFileSync(s.realPath, s.original, { mode: s.mode });
            } catch {
                // best-effort; the .lumen.bak copy still holds the original
            }
        }
        for (const s of staged) removeQuietly(s.tempPath);
        if (renamed.length === 0) for (const b of createdBackups) removeQuietly(b);
        if (err instanceof KubeconfigRenameError) throw err;
        throw new KubeconfigRenameError(`Could not write the kubeconfig: ${err instanceof Error ? err.message : String(err)}`);
    }

    return { changedFiles: staged.map(s => s.realPath), newName: target, renamedCurrentContext };
}
