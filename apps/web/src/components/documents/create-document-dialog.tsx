import { sk } from '@intra/shared/i18n';
import { personName } from '@intra/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { downloadFile } from '@/lib/uploads';
import { trpc } from '@/lib/trpc';

const t = sk.documents;

/** `Ponuka ADOS.docx` → `Ponuka ADOS`: the name a new document starts from. */
const baseName = (name: string) => name.replace(/\.docx$/i, '');

/**
 * „Vytvoriť dokument“: a template from „Šablóny dokumentov“, the person it is for, the fields the
 * template asks for and a name; the filled DOCX goes into the contact's folder.
 */
export function CreateDocumentDialog({
  customer,
  onClose,
}: {
  customer: {
    id: string;
    name: string;
    kind: 'organization' | 'individual';
    contacts: {
      id: string;
      isPrimary: boolean;
      titleBefore: string | null;
      firstName: string;
      lastName: string;
      titleAfter: string | null;
    }[];
  };
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const templates = useQuery(trpc.document.templates.queryOptions());
  const usable = (templates.data?.templates ?? []).filter((template) => template.valid);
  const [templateId, setTemplateId] = useState('');
  const [contactId, setContactId] = useState(customer.contacts.find((c) => c.isPrimary)?.id ?? '');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const template = usable.find((item) => item.id === templateId);
  const create = useMutation(
    trpc.document.create.mutationOptions({
      onSuccess: async (created) => {
        await queryClient.invalidateQueries(trpc.file.pathFilter());
        toast('success', t.created);
        onClose();
        void downloadFile(created.fileId, created.name).catch(() => undefined);
      },
      onError: (error) => toast('error', errorMessage(error, t.errors)),
    }),
  );
  const pick = (id: string) => {
    setTemplateId(id);
    const picked = usable.find((item) => item.id === id);
    if (picked) setName(`${baseName(picked.name)} - ${customer.name}`.slice(0, 180));
    setFields({});
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.lead}</DialogDescription>
        </DialogHeader>
        {templates.data && usable.length === 0 ? (
          <p className="text-sm text-muted">{t.noTemplates}</p>
        ) : (
          <div className="space-y-4">
            <div>
              <Label htmlFor="document-template">{t.template}</Label>
              <Select id="document-template" value={templateId} onChange={pick}>
                <SelectItem value="">{t.pickTemplate}</SelectItem>
                {usable.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {baseName(item.name)}
                  </SelectItem>
                ))}
              </Select>
            </div>
            {customer.kind === 'organization' && customer.contacts.length > 0 ? (
              <div>
                <Label htmlFor="document-contact">{t.contact}</Label>
                <Select id="document-contact" value={contactId} onChange={setContactId}>
                  <SelectItem value="">{t.noContact}</SelectItem>
                  {customer.contacts.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {personName(contact)}
                    </SelectItem>
                  ))}
                </Select>
              </div>
            ) : null}
            {template?.fields.map((field) => (
              <div key={field}>
                <Label htmlFor={`field-${field}`}>{field}</Label>
                <Input
                  id={`field-${field}`}
                  className="mt-1.5"
                  maxLength={5000}
                  value={fields[field] ?? ''}
                  onChange={(event) => setFields({ ...fields, [field]: event.target.value })}
                />
              </div>
            ))}
            {template ? (
              <div>
                <Label htmlFor="document-name">{t.name}</Label>
                <Input
                  id="document-name"
                  className="mt-1.5"
                  maxLength={185}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            ) : null}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {sk.common.cancel}
          </Button>
          <Button
            disabled={!template || !name.trim() || create.isPending}
            onClick={() =>
              create.mutate({
                templateId,
                customerId: customer.id,
                contactId: contactId || null,
                name: name.trim(),
                fields,
              })
            }
          >
            {t.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
