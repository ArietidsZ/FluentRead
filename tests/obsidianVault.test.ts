import {describe, expect, it, vi} from 'vitest';
import {availableOutputPath, createBilingualNote} from '../integrations/obsidian/vault';

type File = Parameters<typeof createBilingualNote>[1];
type Vault = Parameters<typeof createBilingualNote>[0];

function fixture() {
    const entries = new Map([
        ['notes/source.md', 'Original content'],
        ['notes/source.bilingual.md', 'Earlier translation'],
    ]);
    const file = {
        name: 'source.md',
        path: 'notes/source.md',
        parent: {path: 'notes'},
        stat: {mtime: 42, size: 16},
    } as File;
    const create = vi.fn(async (path: string, content: string) => {
        if (entries.has(path)) throw new Error('File already exists');
        entries.set(path, content);
        return {name: path.split('/').at(-1), path} as File;
    });
    const vault = {
        getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
        create,
    } as unknown as Vault;
    return {entries, file, vault, create};
}

describe('Obsidian vault write boundary', () => {
    it('creates a numbered sibling and leaves source and earlier output untouched', async () => {
        const {entries, file, vault, create} = fixture();
        expect(availableOutputPath(vault, file)).toBe('notes/source.bilingual 2.md');
        await createBilingualNote(vault, file, {mtime: 42, size: 16}, 'New bilingual content', new AbortController().signal);
        expect(create).toHaveBeenCalledWith('notes/source.bilingual 2.md', 'New bilingual content');
        expect(entries.get('notes/source.md')).toBe('Original content');
        expect(entries.get('notes/source.bilingual.md')).toBe('Earlier translation');
    });

    it('does not write after cancellation or a source edit', async () => {
        const {file, vault, create} = fixture();
        const controller = new AbortController();
        controller.abort();
        await expect(createBilingualNote(vault, file, {mtime: 42, size: 16}, 'Late output', controller.signal))
            .rejects.toMatchObject({name: 'AbortError'});
        file.stat.mtime = 43;
        await expect(createBilingualNote(vault, file, {mtime: 42, size: 16}, 'Stale output', new AbortController().signal))
            .rejects.toThrow('source file changed');
        expect(create).not.toHaveBeenCalled();
    });
});
