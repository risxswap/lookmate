import { api } from '../lib/api';
import { ApiError } from '../lib/request';
import { getAccount } from '../lib/auth';
import { readDraft, readStored, saveDraft, writeStored } from '../lib/storage';
import type { DesignInput, PendingSubmission, Submission } from '../types/api';
export const pendingSubmission = (accountId?: string) => readStored<PendingSubmission>('design-pending', accountId);
function clearSubmittedDraft(pending: Extract<PendingSubmission, { kind: 'CREATE' }>) {
    const input = pending.input;
    const draft = readDraft<DesignInput>(input.designType, pending.accountId);
    if (!draft) return;
    // Both snapshots are flat input fields and ordered arrays; field order can differ after a reload.
    const fields = Object.keys({ ...draft, ...input }).sort();
    if (JSON.stringify(draft, fields) === JSON.stringify(input, fields)) {
        saveDraft(input.designType, null, pending.accountId);
    }
}
export async function sendSubmission(p: PendingSubmission, recover = false): Promise<Submission> {
    if (getAccount()?.id !== p.accountId)
        throw new Error('账号已变化，请返回首页');
    const pending = pendingSubmission(p.accountId);
    if (pending && pending.key !== p.key) throw new Error('请先找回待确认的提交');
    writeStored('design-pending', p, p.accountId);
    try {
        const result = await (recover ? api.byRequest(p.key) : api.submit(p));
        if (pendingSubmission(p.accountId)?.key === p.key) {
            writeStored('design-pending', null, p.accountId);
            if (p.kind === 'CREATE') clearSubmittedDraft(p);
        }
        return result;
    }
    catch (e) {
        if (!recover && getAccount()?.id === p.accountId && pendingSubmission(p.accountId)?.key === p.key &&
            e instanceof ApiError && e.status >= 400 && e.status < 500 && ![
            'IDEMPOTENCY_CONFLICT', 'TASK_ACCEPTANCE_UNKNOWN'
        ].includes(e.detail.code))
            writeStored('design-pending', null, p.accountId);
        throw e;
    }
}
