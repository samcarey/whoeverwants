// Derive a URL-safe slug from a git branch name.
// e.g., "claude/fix-voting-bug-abc123" -> "fix-voting-bug-abc123"
export function branchToSlug(branch: string): string {
  let slug = branch.replace(/^claude\//, '').toLowerCase();
  slug = slug.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return slug.slice(0, 50);
}
