import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatComment, postComment } from '../pr-comment';
import { getOctokit } from '@actions/github';
import * as core from '@actions/core';

const listComments = vi.fn();
const updateComment = vi.fn();
const createComment = vi.fn();

vi.mock('@actions/github', () => ({
  getOctokit: vi.fn(() => ({
    rest: {
      issues: {
        listComments,
        updateComment,
        createComment
      }
    }
  }))
}));

vi.mock('@actions/core', () => ({
  info: vi.fn()
}));

const MockGetOctokit = getOctokit as unknown as vi.Mock;
const mockCoreInfo = core.info as unknown as vi.Mock;

beforeEach(() => {
  listComments.mockReset();
  updateComment.mockReset();
  createComment.mockReset();
  MockGetOctokit.mockClear();
  mockCoreInfo.mockClear();
});

describe('formatComment', () => {
  it('shows a minimal message when no suggestions are present', () => {
    const comment = formatComment({
      impact_level: 'none',
      summary: 'All good',
      suggestions: []
    });

    expect(comment).toContain('📚 Documentation Check-In');
    expect(comment).toContain('All good');
    expect(comment).toContain("didn't spot any doc updates needed");
  });

  it('renders suggestion details including line numbers and severity', () => {
    const comment = formatComment({
      impact_level: 'medium',
      summary: 'Add onboarding notes',
      suggestions: [
        {
          target_file: 'docs/readme.md',
          target_section: 'Onboarding',
          type: 'add',
          rationale: 'PR adds a new setup step',
          suggested_text: 'New setup instructions',
          severity: 'critical',
          start_line: 4,
          end_line: 8
        }
      ]
    });

    expect(comment).toContain('📚 Documentation Check-In');
    expect(comment).toContain('Suggestion 1');
    expect(comment).toContain('docs/readme.md');
    expect(comment).toContain('lines 4-8');
    expect(comment).toContain('🚨');
  });
});

describe('postComment', () => {
  it('updates an existing bot comment when present', async () => {
    listComments.mockResolvedValue({
      data: [{ id: 42, body: 'Documentation Update Suggestions' }]
    });
    updateComment.mockResolvedValue({});

    await postComment('token', 'owner', 'repo', 7, 'new body');

    expect(updateComment).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      comment_id: 42,
      body: 'new body'
    });
    expect(createComment).not.toHaveBeenCalled();
    expect(MockGetOctokit).toHaveBeenCalledWith('token');
  });

  it('creates a new comment when the bot has not commented', async () => {
    listComments.mockResolvedValue({
      data: [{ id: 1, body: 'Another comment' }]
    });
    createComment.mockResolvedValue({});

    await postComment('token', 'owner', 'repo', 3, 'fresh body');

    expect(createComment).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      issue_number: 3,
      body: 'fresh body'
    });
    expect(updateComment).not.toHaveBeenCalled();
  });
});
