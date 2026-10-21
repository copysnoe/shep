// @vitest-environment node

/**
 * Unit tests — attachment source path policy.
 *
 * `POST /api/attachments/upload-from-path` takes a caller-supplied absolute
 * path, reads it and copies it somewhere the preview route serves back. It
 * had no base directory, no canonicalisation and no containment check, and
 * its extension test was written `if (ext && !ALLOWED.has(ext))` — so a file
 * with NO extension was unconditionally allowed. `/etc/passwd`,
 * `~/.ssh/id_rsa`, `~/.aws/credentials`, `~/.shep/data` and
 * `/proc/self/environ` all qualified.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, join, sep } from 'node:path';
import {
  ATTACHMENT_MAX_FILE_SIZE,
  ATTACHMENT_ROOTS_ENV,
  DENIED_DIRECTORY_SEGMENTS,
  REJECTION,
  resolveAttachmentRoots,
  validateAttachmentSourcePath,
} from '@shepai/core/infrastructure/services/attachments/attachment-source-policy';

const IS_WINDOWS = process.platform === 'win32';

describe('attachment source path policy', () => {
  let root: string;
  let outside: string;
  let savedRootsEnv: string | undefined;

  beforeEach(() => {
    savedRootsEnv = process.env[ATTACHMENT_ROOTS_ENV];
    root = mkdtempSync(join(tmpdir(), 'shep-attach-root-'));
    outside = mkdtempSync(join(tmpdir(), 'shep-attach-outside-'));
  });

  afterEach(() => {
    if (savedRootsEnv === undefined) delete process.env[ATTACHMENT_ROOTS_ENV];
    else process.env[ATTACHMENT_ROOTS_ENV] = savedRootsEnv;
    for (const dir of [root, outside]) {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  function writeFixture(dir: string, name: string, contents = 'hello'): string {
    const path = join(dir, name);
    writeFileSync(path, contents);
    return path;
  }

  describe('containment', () => {
    it('accepts a file inside an allowed root', () => {
      const path = writeFixture(root, 'notes.md');

      const result = validateAttachmentSourcePath(path, [root]);

      expect(result.ok).toBe(true);
    });

    it('rejects a file outside every allowed root', () => {
      const path = writeFixture(outside, 'notes.md');

      const result = validateAttachmentSourcePath(path, [root]);

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe(REJECTION.OutsideAllowedRoots);
    });

    it('rejects a traversal that climbs out of the root', () => {
      writeFixture(outside, 'secret.md');
      const traversal = `${root}${sep}..${sep}${basename(outside)}${sep}secret.md`;

      const result = validateAttachmentSourcePath(traversal, [root]);

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe(REJECTION.OutsideAllowedRoots);
    });

    it('rejects a sibling directory that merely shares the root prefix', () => {
      // `<root>-evil` passes a bare `startsWith(root)` check.
      const sibling = `${root}-evil`;
      mkdirSync(sibling, { recursive: true });
      try {
        const path = writeFixture(sibling, 'notes.md');

        const result = validateAttachmentSourcePath(path, [root]);

        expect(result.ok).toBe(false);
        expect(result.ok === false && result.reason).toBe(REJECTION.OutsideAllowedRoots);
      } finally {
        rmSync(sibling, { recursive: true, force: true });
      }
    });

    it.skipIf(IS_WINDOWS)('rejects a symlink inside the root that points outside it', () => {
      const target = writeFixture(outside, 'stolen.md');
      const link = join(root, 'innocent.md');
      symlinkSync(target, link);

      const result = validateAttachmentSourcePath(link, [root]);

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe(REJECTION.OutsideAllowedRoots);
    });

    it('rejects a relative path outright', () => {
      const result = validateAttachmentSourcePath('notes.md', [root]);

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe(REJECTION.NotAbsolute);
    });
  });

  describe('extension allowlist', () => {
    it('rejects a file with NO extension', () => {
      // The original check was `if (ext && !ALLOWED.has(ext))`, so an empty
      // extension short-circuited the whole allowlist.
      const path = writeFixture(root, 'passwd');

      const result = validateAttachmentSourcePath(path, [root]);

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe(REJECTION.ExtensionNotAllowed);
    });

    it('rejects a dotfile with no extension of its own', () => {
      const path = writeFixture(root, '.npmrc');

      const result = validateAttachmentSourcePath(path, [root]);

      expect(result.ok).toBe(false);
    });

    it('rejects an extension that is not on the allowlist', () => {
      const path = writeFixture(root, 'id_rsa.pem');

      const result = validateAttachmentSourcePath(path, [root]);

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe(REJECTION.ExtensionNotAllowed);
    });

    it('is case-insensitive about extensions', () => {
      const path = writeFixture(root, 'Screenshot.PNG');

      expect(validateAttachmentSourcePath(path, [root]).ok).toBe(true);
    });
  });

  describe('credential stores', () => {
    it.each(DENIED_DIRECTORY_SEGMENTS)('refuses anything under a %s directory', (segment) => {
      const dir = join(root, segment);
      mkdirSync(dir, { recursive: true });
      const path = writeFixture(dir, 'hosts.yml');

      const result = validateAttachmentSourcePath(path, [root]);

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe(REJECTION.DeniedDirectory);
    });

    it('refuses a nested credential directory', () => {
      const dir = join(root, 'projects', '.ssh');
      mkdirSync(dir, { recursive: true });
      const path = writeFixture(dir, 'known_hosts.txt');

      expect(validateAttachmentSourcePath(path, [root]).ok).toBe(false);
    });
  });

  describe('size and file type', () => {
    it('rejects an oversized file from its stat, before reading it', () => {
      const path = join(root, 'big.txt');
      writeFileSync(path, Buffer.alloc(ATTACHMENT_MAX_FILE_SIZE + 1));

      const result = validateAttachmentSourcePath(path, [root]);

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe(REJECTION.TooLarge);
    });

    it('rejects a directory', () => {
      const dir = join(root, 'folder.md');
      mkdirSync(dir);

      const result = validateAttachmentSourcePath(dir, [root]);

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe(REJECTION.NotARegularFile);
    });

    it('rejects a file that does not exist', () => {
      const result = validateAttachmentSourcePath(join(root, 'missing.md'), [root]);

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe(REJECTION.NotFound);
    });

    it('returns the canonical path and size for an accepted file', () => {
      const path = writeFixture(root, 'notes.md', 'hello');

      const result = validateAttachmentSourcePath(path, [root]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // `canonicalPath` is realpath'd, so compare against the canonical root: on
        // macOS `os.tmpdir()` is under /var, a symlink to /private/var.
        expect(result.canonicalPath.startsWith(realpathSync(root))).toBe(true);
        expect(result.size).toBe(5);
        expect(result.filename).toBe('notes.md');
        expect(result.mimeType).toBe('text/markdown');
      }
    });
  });

  describe('resolveAttachmentRoots', () => {
    it('defaults to the home directory', () => {
      delete process.env[ATTACHMENT_ROOTS_ENV];

      const roots = resolveAttachmentRoots(root);

      expect(roots).toEqual([root]);
    });

    it('accepts extra roots from the environment', () => {
      process.env[ATTACHMENT_ROOTS_ENV] = `${root}${delimiter}${outside}`;

      const home = join(root, 'home');
      const roots = resolveAttachmentRoots(home);

      expect(roots).toEqual([home, root, outside]);
    });

    it('ignores blank entries', () => {
      process.env[ATTACHMENT_ROOTS_ENV] = delimiter.repeat(2);

      expect(resolveAttachmentRoots(root)).toEqual([root]);
    });
  });

  it('never treats a root itself as an attachable file', () => {
    const result = validateAttachmentSourcePath(root, [root]);

    expect(result.ok).toBe(false);
  });

  it('normalises separators so the containment check cannot be fooled', () => {
    const path = writeFixture(root, 'notes.md');
    const doubled = path.split(sep).join(sep + sep);

    expect(validateAttachmentSourcePath(doubled, [root]).ok).toBe(true);
  });
});
