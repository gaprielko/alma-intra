import { sk } from '@intra/shared/i18n';
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

const t = sk.products.items;
type Item = RouterOutputs['product']['items'][number];

/** A new item of the catalog, or one renamed (the new name shows in every product). */
export function ItemDialog({
  item,
  onClose,
  onCreated,
}: {
  item?: Pick<Item, 'id' | 'name' | 'unit' | 'description'> | undefined;
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState(item?.name ?? '');
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const onError = (error: unknown) => toast('error', errorMessage(error, sk.products.errors));
  const create = useMutation(
    trpc.product.itemCreate.mutationOptions({
      onSuccess: async (created) => {
        toast('success', t.created);
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
        toast('success', t.saved);
        await queryClient.invalidateQueries(trpc.product.pathFilter());
        onClose();
      },
      onError,
    }),
  );
  const input = { name, unit, description };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{item ? t.dialogEdit : t.dialogNew}</DialogTitle>
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
            <Button type="submit" disabled={!name.trim() || create.isPending || update.isPending}>
              {sk.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
