import { sk } from '@intra/shared/i18n';
import { FILE_ACCEPT } from '@intra/shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Upload } from 'lucide-react';
import { useRef } from 'react';
import { FileBadge } from '@/components/files/file-bits';
import { ErrorState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { formatDate } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { useCan } from '@/lib/session';
import { trpc } from '@/lib/trpc';
import { uploadFiles } from '@/lib/uploads';

const t = sk.files.customerCard;

/** The customer's newest files, an upload into the customer's folder and the way to all of them. */
export function CustomerFilesCard({ customerId }: { customerId: string }) {
  const canWrite = useCan('file.write');
  const picker = useRef<HTMLInputElement>(null);
  const files = useQuery(trpc.file.customerFiles.queryOptions({ customerId }));
  const status = useQuery(trpc.file.status.queryOptions());
  const rootId = files.data?.rootId;

  return (
    <Card>
      <CardHeader
        title={files.data ? `${t.title} · ${files.data.total}` : t.title}
        action={
          canWrite && rootId && status.data?.configured ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => picker.current?.click()}>
                <Upload className="size-3.5" aria-hidden />
                {t.upload}
              </Button>
              <input
                ref={picker}
                type="file"
                multiple
                hidden
                accept={FILE_ACCEPT}
                onChange={(event) => {
                  if (event.target.files) void uploadFiles([...event.target.files], rootId);
                  event.target.value = '';
                }}
              />
            </>
          ) : null
        }
      />
      <div className="px-5 pt-2 pb-4">
        {files.isPending ? (
          <p className="text-sm text-muted">{sk.common.loading}</p>
        ) : loadFailed(files) ? (
          <ErrorState compact onRetry={() => void files.refetch()} />
        ) : files.data.files.length === 0 ? (
          <p className="py-2 text-sm text-muted">{t.empty}</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {files.data.files.map((file) => (
              <li key={file.id} className="flex items-center gap-3 py-2.5">
                <FileBadge name={file.name} />
                <div className="min-w-0">
                  <Link
                    to="/files"
                    search={{ folder: file.folderId, file: file.id }}
                    className="block truncate text-sm font-semibold hover:text-primary-text hover:underline"
                  >
                    {file.name}
                  </Link>
                  <p className="truncate text-xs text-muted">
                    {[
                      formatDate(file.changedAt),
                      file.changedBy,
                      file.version > 1 ? `v${file.version}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {rootId ? (
          <Link
            to="/files"
            search={{ folder: rootId }}
            className="mt-2 inline-block text-[13px] font-semibold text-primary-text hover:underline"
          >
            {files.data && files.data.total > files.data.files.length
              ? t.more(files.data.total)
              : t.open}
          </Link>
        ) : null}
      </div>
    </Card>
  );
}
