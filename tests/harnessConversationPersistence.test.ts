import 'fake-indexeddb/auto';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createHarnessConversationRuntime} from '@/src/services/harness/conversation';
import {FluentReadHarnessSessionDatabase, HarnessSessionRepository} from '@/src/platform/storage/harnessSessionRepository';
import type {HarnessRuntime} from '@/src/services/harness/runtime';
import type {ReadingProgress, ReadingRequest, ReadingResponse} from '@/src/features/reading-assistant/types';
const databases: FluentReadHarnessSessionDatabase[] = [];
let sequence = 0;
const request = (extra: Partial<ReadingRequest> = {}): ReadingRequest => ({type: 'fluentReadHarness', action: 'run', requestId: 'run', selection: {text: 'Original sentence', context: 'Original paragraph', sentence: ''}, intent: 'meaning', question: '', ...extra});
const success: ReadingResponse = {success: true, text: 'First paragraph.\n\nSecond paragraph.', model: 'm', service: 'openai'};
function repository(name = `Harness-real-conversation-${++sequence}`) {const database = new FluentReadHarnessSessionDatabase(name); databases.push(database); return new HarnessSessionRepository(database);}
function conversation(store: HarnessSessionRepository, runtime: HarnessRuntime) {return createHarnessConversationRuntime({store, runtime, preferences: () => ({contextMode: 'paragraph', maxContextChars: 1500})});}
async function until(check: () => boolean) {for (let i = 0; i < 200 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 5)); expect(check()).toBe(true);}
afterEach(async () => {for (const database of databases.splice(0)) {database.close(); await database.delete();}});

describe('Harness streaming with real IndexedDB persistence', () => {
    it('creates a session before model metadata arrives and restores exact saved answers for follow-up', async () => {
        const store = repository();
        const runtime: HarnessRuntime = {run: vi.fn(async (_request, _signal, publish) => {publish?.({kind: 'model', service: 'openai', model: 'm'}); publish?.({kind: 'text', text: 'First'}); return success;})};
        const current = conversation(store, runtime);
        const result = await current.run(request(), new AbortController().signal);
        expect(result.success && result.sessionId).toBeTruthy();
        if (!result.success) throw new Error('Expected success');
        const saved = await store.get(result.sessionId!);
        expect(saved?.turns[0]).toMatchObject({answer: success.text, status: 'completed', service: 'openai', model: 'm'});
        expect(saved?.turns[0].answer).toContain('\n\n');
        await current.run(request({sessionId: result.sessionId, selection: {text: 'Wrong page', context: 'Wrong paragraph', sentence: ''}, question: 'Why?'}), new AbortController().signal);
        const followup = vi.mocked(runtime.run).mock.calls[1][0];
        expect(followup.selection).toMatchObject({text: 'Original sentence', context: 'Original paragraph'});
        expect(followup.history).toEqual([{question: '读懂', answer: success.text}]);
        expect((await store.get(result.sessionId!))?.turns).toHaveLength(2);
    });
    it('checkpoints partial output and retains it as stopped when the user cancels', async () => {
        const store = repository();
        let publish: ((progress: ReadingProgress) => void) | undefined;
        let finish!: (response: ReadingResponse) => void;
        const current = conversation(store, {run: async (_request, _signal, callback) => {publish = callback; return new Promise(resolve => {finish = resolve;});}});
        const controller = new AbortController();
        const running = current.run(request(), controller.signal);
        await until(() => Boolean(publish));
        publish!({kind: 'text', text: '已生成一部分'});
        await new Promise(resolve => setTimeout(resolve, 550));
        const id = (await store.list()).sessions[0].id;
        expect((await store.get(id))?.turns[0]).toMatchObject({answer: '已生成一部分', status: 'streaming', service: '', model: ''});
        controller.abort(); finish(success);
        expect(await running).toMatchObject({cancelled: true});
        expect((await store.get(id))?.turns[0]).toMatchObject({answer: '已生成一部分', status: 'stopped'});
    });
    it('clear during an active stream prevents final write resurrection in the real repository', async () => {
        const store = repository();
        let finish: ((response: ReadingResponse) => void) | undefined;
        const current = conversation(store, {run: async () => new Promise(resolve => {finish = resolve;})});
        const running = current.run(request(), new AbortController().signal);
        await until(() => Boolean(finish));
        expect((await store.list()).sessions).toHaveLength(1);
        await store.clear(); finish!(success);
        expect(await running).toMatchObject({success: true, persistenceWarning: expect.any(String)});
        expect((await store.list()).sessions).toEqual([]);
    });
    it.each(['delete', 'clear'] as const)('%s while a saved session is loading prevents its stale snapshot from being saved again', async operation => {
        const store = repository();
        const current = conversation(store, {run: async () => success});
        const initial = await current.run(request(), new AbortController().signal);
        if (!initial.success || !initial.sessionId) throw new Error('Expected a saved session');
        const sessionId = initial.sessionId;
        const readSession = store.get.bind(store);
        let announceSnapshot!: () => void;
        let releaseSnapshot!: () => void;
        const snapshotReady = new Promise<void>(resolve => {announceSnapshot = resolve;});
        const snapshotReleased = new Promise<void>(resolve => {releaseSnapshot = resolve;});
        vi.spyOn(store, 'get').mockImplementationOnce(async id => {
            const snapshot = await readSession(id);
            announceSnapshot();
            await snapshotReleased;
            return snapshot;
        });
        const restoring = current.run(request({sessionId, question: 'Continue?'}), new AbortController().signal);
        await snapshotReady;
        if (operation === 'delete') await store.delete(sessionId);
        else await store.clear();
        expect(await readSession(sessionId)).toBeNull();
        releaseSnapshot();
        const result = await restoring;
        expect(result).toMatchObject({success: true, persistenceWarning: expect.any(String)});
        expect(result).not.toHaveProperty('sessionId');
        expect(await readSession(sessionId)).toBeNull();
        expect((await store.list()).sessions).toEqual([]);
    });
    it('recovers an interrupted checkpoint after a new repository instance starts', async () => {
        const name = `Harness-restart-${++sequence}`;
        const first = repository(name);
        const now = Date.now();
        await first.upsertTurn({id: 'session', text: 'Saved', context: '', createdAt: now, updatedAt: now, intent: 'grammar'}, {id: 'turn', question: '拆句', answer: 'Partial\nanswer', intent: 'grammar', status: 'streaming', createdAt: now, service: '', model: ''}, first.captureGeneration('session'));
        first.database.close();
        const restarted = repository(name);
        await restarted.recoverInterrupted();
        expect((await restarted.get('session'))?.turns[0]).toMatchObject({answer: 'Partial\nanswer', status: 'stopped'});
    });
});
