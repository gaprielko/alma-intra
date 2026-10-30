import { sk } from '@intra/shared/i18n';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FileBadge } from '@/components/files/file-bits';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { formatSize, previewKind } from '@/lib/files';
import { safeDocument } from '@/lib/safe-html';
import { trpcClient } from '@/lib/trpc';
import { downloadFile } from '@/lib/uploads';

const t = sk.files;
const d = t.previewDialog;

export interface PreviewedFile {
  id: string;
  name: string;
  size: number;
  version: number;
  folderName: string;
  folderPath: string | null;
}

/**
 * A file over the list: its name, „Verzie“ and „Stiahnuť“, and what can be shown of it. HTML runs in
 * a frame without scripts (it is whoever wrote it, and must not act as the app). A PDF becomes a
 * blob typed as a PDF, whatever the bytes are, so it can only open in the browser's PDF viewer: a
 * sandboxed frame would stop that viewer. A type that cannot be shown says so.
 */
export function FilePreviewDialog({
  file,
  onClose,
  onVersions,
}: {
  file: PreviewedFile;
  onClose: () => void;
  onVersions: () => void;
}) {
  const toast = useToast();
  const kind = previewKind(file.name);
  // Every fetch leaves a trace in the audit trail: once per opening, not on each return to the tab.
  const content = useQuery({
    queryKey: ['file-preview', file.id, file.version],
    enabled: kind !== null,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      const { url } = await trpcClient.file.download.mutate({ id: file.id, inline: true });
      if (kind === 'image') return { image: url };
      const response = await fetch(url);
      if (!response.ok) throw new Error(`GET ${response.status}`);
      if (kind === 'html') return { html: await response.text() };
      return { pdf: new Blob([await response.arrayBuffer()], { type: 'application/pdf' }) };
    },
  });
  const pdf = content.data?.pdf;
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!pdf) return;
    const url = URL.createObjectURL(pdf);
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pdf]);

  const save = () =>
    void downloadFile(file.id, file.name).catch((error: unknown) =>
      toast('error', errorMessage(error, t.errors)),
    );
  const versions = (
    <Button variant="secondary" aria-label={t.detailOf(file.name)} onClick={onVersions}>
      {t.versions(file.version)}
    </Button>
  );
  const download = (
    <Button onClick={save}>
      <Download className="size-4" aria-hidden />
      {d.download}
    </Button>
  );
  const status = (text: string) => (
    <p className="flex h-full items-center justify-center p-6 text-sm text-muted">{text}</p>
  );

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent
        size={kind ? 'lg' : 'md'}
        className={
          kind
            ? 'h-[calc(100vh-2rem)] max-w-[65rem] gap-0 overflow-hidden p-0'
            : 'gap-0 overflow-hidden p-0'
        }
      >
        <header className="flex flex-wrap items-center gap-3 border-b border-border-subtle py-3.5 pr-16 pl-5">
          <FileBadge name={file.name} />
          <div className="min-w-0 flex-[1_1_15rem]">
            <DialogTitle className="text-base break-words">{file.name}</DialogTitle>
            <DialogDescription>
              {file.folderPath ?? file.folderName} · {formatSize(file.size)}
            </DialogDescription>
          </div>
          {kind ? (
            <>
              {versions}
              {download}
            </>
          ) : null}
        </header>
        {kind === null ? (
          <div className="px-6 py-10 text-center">
            <p className="text-[15px]">{d.none}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {versions}
              {download}
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 bg-surface">
            {content.isError ? status(d.failed) : null}
            {content.isPending ? status(d.loading) : null}
            {content.data?.image ? (
              <div className="flex h-full items-center justify-center p-4">
                <img
                  src={content.data.image}
                  alt={file.name}
                  className="max-h-full max-w-full rounded-lg object-contain"
                />
              </div>
            ) : null}
            {content.data?.html !== undefined ? (
              <iframe
                title={file.name}
                // No scripts, no forms, no popups. The origin is kept only so the frame paints;
                // without scripts nothing can use it.
                sandbox="allow-same-origin"
                srcDoc={safeDocument(content.data.html)}
                className="block h-full w-full border-0 bg-white"
              />
            ) : null}
            {pdfUrl ? (
              <iframe title={file.name} src={pdfUrl} className="block h-full w-full border-0" />
            ) : null}
          </div>
        )}
        {content.data?.html !== undefined ? (
          <p className="border-t border-border-subtle px-5 py-2 text-xs text-muted">{d.htmlNote}</p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
