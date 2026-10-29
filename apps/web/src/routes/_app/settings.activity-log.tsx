import { sk } from '@intra/shared/i18n';
import { AUDIT_AREAS, type AuditArea } from '@intra/shared/schemas';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Bot } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { TablePagination, TableShell } from '@/components/table-shell';
import { Select, SelectItem } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { TableCell, TableRow } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { loadFailed } from '@/lib/query-view';
import { type RouterOutputs, trpc } from '@/lib/trpc';

const t = sk.activityLog;

export const Route = createFileRoute('/_app/settings/activity-log')({
  component: ActivityLogPage,
});

type Row = RouterOutputs['audit']['list']['items'][number];

/** `customer.update.denied` → the label of `customer.update`, and whether it was refused. */
function describeAction(action: string) {
  const outcome = /\.(denied|failed)$/.exec(action)?.[1] as 'denied' | 'failed' | undefined;
  const base = outcome ? action.slice(0, -outcome.length - 1) : action;
  return { label: t.actions[base], code: base, outcome };
}

/** Where a row's subject opens, when it is something the app shows on its own page. */
function SubjectLink({ row }: { row: Row }) {
  if (!row.subject || !row.entityId) return <span className="text-muted">{sk.common.none}</span>;
  if (row.entityType === 'customer') {
    return (
      <Link
        to="/customers/$customerId"
        params={{ customerId: row.entityId }}
        className="text-primary-text hover:underline"
      >
        {row.subject}
      </Link>
    );
  }
  if (row.entityType === 'campaign') {
    return (
      <Link
        to="/emails/sent/$campaignId"
        params={{ campaignId: row.entityId }}
        className="text-primary-text hover:underline"
      >
        {row.subject}
      </Link>
    );
  }
  if (row.entityType === 'inbound') {
    return (
      <Link
        to="/emails/inbox/$inboundId"
        params={{ inboundId: row.entityId }}
        className="text-primary-text hover:underline"
      >
        {row.subject}
      </Link>
    );
  }
  return <span>{row.subject}</span>;
}

/**
 * Nastavenia › Záznam aktivít (D-16): the whole app's audit trail, newest first, by person, area
 * and whether Claude did it; names are read now, the trail itself keeps ids only.
 */
function ActivityLogPage() {
  const [page, setPage] = useState(1);
  const [userId, setUserId] = useState('');
  const [area, setArea] = useState<AuditArea | ''>('');
  const [claudeOnly, setClaudeOnly] = useState(false);
  const people = useQuery(trpc.customer.options.queryOptions());
  const list = useQuery({
    ...trpc.audit.list.queryOptions({
      page,
      ...(userId ? { userId } : {}),
      ...(area ? { area } : {}),
      claudeOnly,
    }),
    placeholderData: keepPreviousData,
  });
  const reset =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      setPage(1);
      set(value);
    };
  const rows = list.data?.items ?? [];
  return (
    <main className="max-w-[1440px] space-y-4 px-7 pt-5 pb-10">
      <p className="text-sm text-muted">{t.lead}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Select aria-label={t.filters.who} value={userId} onChange={reset(setUserId)}>
            <SelectItem value="">{t.filters.anyone}</SelectItem>
            {(people.data?.users ?? []).map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.name}
              </SelectItem>
            ))}
          </Select>
        </div>
        <div className="w-56">
          <Select
            aria-label={t.filters.area}
            value={area}
            onChange={reset((value: string) => setArea(value as AuditArea | ''))}
          >
            <SelectItem value="">{t.filters.anywhere}</SelectItem>
            {AUDIT_AREAS.map((key) => (
              <SelectItem key={key} value={key}>
                {t.areas[key]}
              </SelectItem>
            ))}
          </Select>
        </div>
        <label className="flex h-10 items-center gap-2 text-sm">
          <Switch
            checked={claudeOnly}
            label={t.filters.claudeOnly}
            onChange={() => reset(setClaudeOnly)(!claudeOnly)}
          />
          {t.filters.claudeOnly}
        </label>
      </div>
      {loadFailed(list) ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : list.data && rows.length === 0 && page === 1 ? (
        <EmptyState title={t.empty} />
      ) : (
        <TableShell
          columns={[t.columns.when, t.columns.who, t.columns.what, t.columns.subject]}
          columnClassNames={['w-44', undefined, undefined, 'hidden lg:table-cell']}
          loading={list.isPending}
          refreshing={list.isPlaceholderData}
          footer={
            <TablePagination page={page} total={list.data?.total ?? 0} onPageChange={setPage} />
          }
        >
          {rows.map((row) => {
            const action = describeAction(row.action);
            return (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-muted tabular-nums">
                  {formatDateTime(row.at)}
                </TableCell>
                <TableCell>
                  {row.actorKind === 'claude' ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Bot className="size-3.5 text-primary-text" aria-hidden />
                      {t.claudeFor(row.userName ?? t.nobody)}
                    </span>
                  ) : (
                    (row.userName ?? t.nobody)
                  )}
                </TableCell>
                <TableCell>
                  {action.label ?? <code className="text-xs">{action.code}</code>}
                  {action.outcome ? (
                    <span className="ml-1.5 text-xs font-semibold text-danger">
                      {t[action.outcome]}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <SubjectLink row={row} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableShell>
      )}
    </main>
  );
}
