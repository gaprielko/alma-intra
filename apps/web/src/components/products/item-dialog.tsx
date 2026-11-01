import { sk } from '@intra/shared/i18n';
import { PRODUCT_APPS, type ProductApp, type ProductItemKind } from '@intra/shared/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const t = sk.products.items;
type Item = RouterOutputs['product']['items'][number];

/**
 * A new role or other item of the catalog, or one changed (a new name shows in every product). A role
 * reaches at least one application (R-21).
 */
export function ItemDialog({
  kind,
  item,
  onClose,
  onCreated,
}: {
  kind: ProductItemKind;
  item?: Pick<Item, 'id' | 'name' | 'unit' | 'description' | 'apps'> | undefined;
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState(item?.name ?? '');
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [apps, setApps] = useState<ProductApp[]>(item?.apps ?? []);
  const copy = t[kind];
  const isRole = kind === 'role';
  const onError = (error: unknown) => toast('error', errorMessage(error, sk.products.errors));
  const create = useMutation(
    trpc.product.itemCreate.mutationOptions({
      onSuccess: async (created) => {
        toast('success', copy.created);
        await queryClient.invalidateQueries(trpc.product.pathFilter());
        onCreated?.(created.id);
        onClose();
      },
      onError,
    }),
  );
  const update = useMutation(
    trpc.product.itemUpdate.mutationOptions({
      onSuccess: async () => {
        toast('success', copy.saved);
        await queryClient.invalidateQueries(trpc.product.pathFilter());
        onClose();
      },
      onError,
    }),
  );
  const input = { kind, name, unit, description, apps: isRole ? apps : [] };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{item ? copy.dialogEdit : copy.dialogNew}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (item) update.mutate({ id: item.id, item: input });
            else create.mutate(input);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="item-name">{t.name}</Label>
            <Input id="item-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="item-unit">{t.unit}</Label>
            <Input id="item-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </div>
          {isRole ? (
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-medium text-muted">{t.apps}</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {PRODUCT_APPS.map((app) => {
                  const on = apps.includes(app);
                  return (
                    <label
                      key={app}
                      className={cn(
                        'flex cursor-pointer items-center gap-2.5 rounded-xl border border-border-subtle px-3 py-2.5 text-sm font-semibold',
                        on && 'border-primary bg-primary-soft/40',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setApps(on ? apps.filter((other) => other !== app) : [...apps, app])
                        }
                        className="size-4 accent-[var(--color-primary)]"
                      />
                      {sk.products.apps[app]}
                    </label>
                  );
                })}
              </div>
              <p className="text-xs text-muted">{t.appsHint}</p>
            </fieldset>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="item-description">{t.description}</Label>
            <Textarea
              id="item-description"
              rows={2}
              maxLength={400}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {sk.common.cancel}
            </Button>
            <Button
              type="submit"
              disabled={
                !name.trim() ||
                (isRole && apps.length === 0) ||
                create.isPending ||
                update.isPending
              }
            >
              {sk.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
