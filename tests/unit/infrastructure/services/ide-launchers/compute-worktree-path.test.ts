// @vitest-environment node

/**
 * computeWorktreePath Unit Tests
 *
 * Tests for the shared utility that computes the worktree path for a given
 * repository path and branch name.
 *
 * TDD Phase: RED → GREEN
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

vi.mock('node:os', () => ({
  homedir: () => '/mock',
}));

import { computeWorktreePath } from '@/infrastructure/services/ide-launchers/compute-worktree-path.js';

describe('computeWorktreePath', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should compute correct worktree path for repo and branch', () => {
    // Pinned: `SHEP_HOME` overrides the home directory, and the documented test
    // recipe sets it — without this the expectation below depends on the shell.
    vi.stubEnv('SHEP_HOME', undefined);
    const repoPath = '/home/user/project';
    const branch = 'feat/my-feature';

    const expectedHash = createHash('sha256').update(repoPath).digest('hex').slice(0, 16);
    const expected = join('/mock/.shep', 'repos', expectedHash, 'wt', 'feat-my-feature').replace(
      /\\/g,
      '/'
    );

    expect(computeWorktreePath(repoPath, branch)).toBe(expected);
  });

  it('places the worktree under SHEP_HOME when it is set', () => {
    vi.stubEnv('SHEP_HOME', '/isolated/shep-home');

    const result = computeWorktreePath('/home/user/project', 'feat/my-feature');

    expect(result.startsWith('/isolated/shep-home/repos/')).toBe(true);
    expect(result).not.toContain('/mock/.shep');
  });

  it('should replace slashes in branch name with hyphens', () => {
    const result = computeWorktreePath('/repo', 'feat/some/nested/branch');
    expect(result).toContain('feat-some-nested-branch');
  });

  it('should handle single-segment branch name without slashes', () => {
    const result = computeWorktreePath('/repo', 'main');
    expect(result).toContain('wt/main');
  });

  it('should produce a deterministic 16-char hex hash of the repo path', () => {
    const result = computeWorktreePath('/home/user/project', 'main');
    const expectedHash = createHash('sha256')
      .update('/home/user/project')
      .digest('hex')
      .slice(0, 16);
    expect(result).toContain(`repos/${expectedHash}/`);
  });

  it('should produce different hashes for different repo paths', () => {
    const path1 = computeWorktreePath('/repo/a', 'main');
    const path2 = computeWorktreePath('/repo/b', 'main');
    expect(path1).not.toBe(path2);
  });

  it('should produce same path for same inputs', () => {
    const result1 = computeWorktreePath('/home/user/project', 'feat/test');
    const result2 = computeWorktreePath('/home/user/project', 'feat/test');
    expect(result1).toBe(result2);
  });

  describe('shell-unsafe branch names (C6)', () => {
    it('never puts a shell metacharacter in the worktree path', () => {
      const result = computeWorktreePath('/repo', 'feat/x$(touch proof)');

      expect(result).not.toMatch(/[$()`;&|<>'"\s]/);
    });

    it('keeps the slug inside the safe character set', () => {
      const result = computeWorktreePath('/repo', 'feat/a b;c&d');
      const slug = result.slice(result.lastIndexOf('/') + 1);

      expect(slug).toMatch(/^[A-Za-z0-9._-]+$/);
    });

    it('leaves ordinary branch names byte-identical', () => {
      expect(computeWorktreePath('/repo', 'feat/my-feature')).toContain('wt/feat-my-feature');
    });
  });
});
