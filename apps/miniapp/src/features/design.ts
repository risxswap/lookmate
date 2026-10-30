import { api } from '../lib/api';
import { ApiError } from '../lib/request';
import { getAccount } from '../lib/auth';
import { readStored, writeStored, saveDraft } from '../lib/storage';
import type { PendingSubmission, Submission } from '../types/api';
export const pendingSubmission = () => readStored<PendingSubmission>('design-pending');
export function rememberSubmission(p: PendingSubmission) {
    writeStored('design-pending', p, p.accountId);
}
export async function sendSubmission(p: PendingSubmission, recover = false): Promise<Submission> {
    if (getAccount()?.id !== p.accountId)
        throw new Error('账号已变化，请返回首页');
    rememberSubmission(p);
    try {
        const result = await (recover ? api.byRequest(p.key) : api.submit(p));
        writeStored('design-pending', null, p.accountId);
        if (p.kind === 'CREATE')
            saveDraft(p.input.designType, null);
        return result;
    }
    catch (e) {
        if (!recover && e instanceof ApiError && e.status >= 400 && e.status < 500 && ![
            'IDEMPOTENCY_CONFLICT', 'TASK_ACCEPTANCE_UNKNOWN'
        ].includes(e.detail.code))
            writeStored('design-pending', null, p.accountId);
        throw e;
    }
}
