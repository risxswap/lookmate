import { useEffect, useState } from 'react';
import { Button, Modal, Skeleton } from 'antd';
import { QueryFailure } from '../workspace/TaskViews';
import { DressEditor } from './DressEditor';
import { useDress, type Category, type Dress } from './queries';

// Capture a fresh response once so background recognition updates never reset form input.
export function DressEditorLoader({ accountId, id, categories, onClose }: { accountId: string; id: string; categories: Category[]; onClose: () => void }) {
  const query = useDress(accountId, id, true);
  const [dress, setDress] = useState<Dress>();
  useEffect(() => {
    if (!dress && query.isFetchedAfterMount && !query.isFetching && query.isSuccess) setDress(query.data);
  }, [dress, query.isFetchedAfterMount, query.isFetching, query.isSuccess, query.data]);
  return dress ? <DressEditor accountId={accountId} categories={categories} dress={dress} onClose={onClose} /> : <Modal title="编辑单品" open onCancel={onClose} footer={<Button onClick={onClose}>取消</Button>}>
    {query.isError ? <QueryFailure stale={false} error={query.error} loading={query.isFetching} retry={() => void query.refetch()} /> : <Skeleton active paragraph={{ rows: 5 }} />}
  </Modal>;
}
