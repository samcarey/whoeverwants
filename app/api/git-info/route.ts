import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';

export const dynamic = 'force-dynamic';

async function readGitHead(): Promise<string | null> {
  try {
    const gitDir = join(process.cwd(), '.git');
    const headContent = (await readFile(join(gitDir, 'HEAD'), 'utf-8')).trim();

    if (headContent.startsWith('ref: ')) {
      const refPath = join(gitDir, headContent.slice(5));
      return (await readFile(refPath, 'utf-8')).trim();
    }
    // Detached HEAD — content is the SHA itself
    return headContent;
  } catch {
    return null;
  }
}

export async function GET() {
  const sha = await readGitHead();
  if (!sha) {
    return NextResponse.json({ error: 'Could not read git HEAD' }, { status: 500 });
  }
  return NextResponse.json({ sha });
}
